"""语义索引：将已发布 chunks 写入 LanceDB，对齐 index_publications.generation。

组件缺失或失败时不阻塞 FTS；配置／模型变化使用独立索引空间。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from pathlib import Path
from typing import Callable, Optional

from app.application.errors.exceptions import ConflictError
from app.application.services.background_jobs import JobCancelled, JobContext, JobSuperseded, get_job_runner
from app.domain.models.background_job import BackgroundJob
from app.domain.models.document_knowledge import IndexPublication, SemanticIndexState, SemanticIndexSummary
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind, OperationStatus
from app.domain.models.workspace import FolderStatus, WorkspaceStatus
from app.domain.models.semantic_index import (
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_COMPONENT_ID,
    EMBEDDING_CONFIG_FINGERPRINT,
    OCR_COMPONENT_ID,
    SEMANTIC_INDEX_CHUNK_BATCH,
)
from app.domain.repositories.uow import IUnitOfWork
from app.infrastructure.external.embedding.e5_onnx import E5OnnxEmbedder, l2_normalize
from app.infrastructure.external.vector_store.lancedb_store import LanceChunkStore
from core.paths import data_root

logger = logging.getLogger(__name__)


class SemanticIndexService:
    def __init__(
            self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
            *, components=None, wake: Optional[Callable[[], None]] = None,
            document_index=None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._components = components
        self._wake = wake
        self._document_index = document_index
        self._embedder: E5OnnxEmbedder | None = None
        self._compute_slot = asyncio.Semaphore(1)

    def wake(self) -> None:
        if self._wake is not None:
            self._wake()
        else:
            try:
                get_job_runner().wake()
            except RuntimeError:
                pass

    def _indexes_root(self) -> Path:
        return data_root().indexes

    async def embedding_available(self) -> bool:
        if self._components is None:
            return False
        try:
            status = await self._components.status(EMBEDDING_COMPONENT_ID)
            return status.state.value == "available"
        except Exception:  # noqa: BLE001
            return False

    async def active_config(self) -> str | None:
        if not await self.embedding_available():
            return None
        if self._components is None:
            return EMBEDDING_CONFIG_FINGERPRINT
        path = await self._components.locate(EMBEDDING_COMPONENT_ID)
        # 已发布收据的目录是不可变安装实例。组件切换后向量使用独立空间。
        identity = hashlib.sha256(path.name.encode()).hexdigest()[:16]
        return f"{EMBEDDING_CONFIG_FINGERPRINT}-{identity}"

    async def _embedder_or_none(self, config: str) -> E5OnnxEmbedder | None:
        if config != await self.active_config():
            return None
        if self._components is not None:
            path = await self._components.locate(EMBEDDING_COMPONENT_ID)
            identity = hashlib.sha256(path.name.encode()).hexdigest()[:16]
            if config != f"{EMBEDDING_CONFIG_FINGERPRINT}-{identity}":
                return None
            if self._embedder is None or Path(self._embedder.root) != path:
                self._embedder = E5OnnxEmbedder(path)
        return self._embedder

    def store_for(self, workspace_id: str, embedding_config: str = EMBEDDING_CONFIG_FINGERPRINT) -> LanceChunkStore:
        return LanceChunkStore(self._indexes_root(), workspace_id, embedding_config)

    async def query(self, workspace_id: str, config: str, text: str, *, version: int, generation: int, limit: int):
        embedder = await self._embedder_or_none(config)
        if embedder is None:
            return None

        def read():
            store = self.store_for(workspace_id, config)
            return store.search(embedder.embed_query(text), limit=limit, version=version, generation=generation)

        async with self._compute_slot:
            return await self._run_blocking(read)

    @staticmethod
    async def _eligible(uow: IUnitOfWork, pub: IndexPublication) -> bool:
        workspace = await uow.workspace.get(pub.workspace_id)
        root = await uow.root.workspace_folder(pub.workspace_id)
        return bool(workspace and workspace.status is WorkspaceStatus.ACTIVE and root
                    and root.status is FolderStatus.AVAILABLE and not pub.policy.paused and not pub.scope_review_required)

    @staticmethod
    def _aligned(pub: IndexPublication, config: str) -> bool:
        return bool(pub.embedding_config == config and pub.vector_generation == pub.generation
                    and pub.vector_table_version is not None and pub.generation > 0)

    async def _verify_publication(self, pub: IndexPublication, config: str) -> None:
        store = self.store_for(pub.workspace_id, config)
        await asyncio.to_thread(store.open_at_version, pub.vector_table_version)

    async def summary(self, workspace_id: str) -> SemanticIndexSummary:
        state = SemanticIndexState
        config = await self.active_config()
        if config is None:
            return SemanticIndexSummary(state=state.NOT_INSTALLED)
        async with self._read_uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id)
            if not pub or not pub.generation or not await uow.document.count_published_chunks(workspace_id):
                return SemanticIndexSummary(state=state.EMPTY)
            root = await uow.root.workspace_folder(workspace_id)
            if not root or root.status is not FolderStatus.AVAILABLE:
                return SemanticIndexSummary(state=state.BLOCKED)
            eligible = await self._eligible(uow, pub)
            job = await uow.job.get(pub.semantic_operation_id) if pub.semantic_operation_id else None
        if job and not job.status.terminal and eligible:
            return SemanticIndexSummary(
                state=state.RUNNING if job.status is OperationStatus.RUNNING else state.QUEUED,
                operation_id=job.operation_id, phase=job.phase, progress=job.progress,
            )
        if self._aligned(pub, config):
            try:
                await self._verify_publication(pub, config)
            except Exception:
                logger.warning("向量发布版本不可读 workspace=%s", workspace_id, exc_info=True)
                return SemanticIndexSummary(state=state.FAILED, error="向量索引不可读，请重建")
            return SemanticIndexSummary(state=state.READY, published_version=pub.vector_table_version)
        if not eligible:
            return SemanticIndexSummary(state=state.PAUSED if pub.policy.paused else state.BLOCKED)
        if job and job.status in (OperationStatus.FAILED, OperationStatus.CANCELLED):
            return SemanticIndexSummary(
                state=state.FAILED, operation_id=job.operation_id, error=job.error.message if job.error else "语义索引已取消",
            )
        return SemanticIndexSummary(state=state.PENDING)

    async def enqueue(self, workspace_id: str, *, retry: bool = False) -> Optional[BackgroundJob]:
        config = await self.active_config()
        if config is None:
            if retry:
                raise ConflictError("语义检索组件不可用")
            return None

        # 已发布但文件损坏时，允许重建；健康的重复请求返回现有操作。
        damaged_version = None
        if retry:
            async with self._read_uow_factory() as uow:
                pub = await uow.document.get_publication(workspace_id)
            if pub and self._aligned(pub, config):
                try:
                    await self._verify_publication(pub, config)
                except Exception:
                    damaged_version = pub.vector_table_version

        async with self._uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id)
            if not pub or not await self._eligible(uow, pub) or not await uow.document.count_published_chunks(workspace_id):
                if retry:
                    raise ConflictError("工作区当前没有可重建的语义索引")
                return None
            existing = await uow.job.get(pub.semantic_operation_id) if pub.semantic_operation_id else None
            if existing and not existing.status.terminal:
                return existing
            if self._aligned(pub, config) and pub.vector_table_version != damaged_version:
                return existing if retry else None
            failed = existing and existing.status in (OperationStatus.FAILED, OperationStatus.CANCELLED)
            if failed and not retry:
                if (existing.payload.get("source_generation"), existing.payload.get("embedding_config")) == (pub.generation, config):
                    return None
            if failed and retry:
                saved = await uow.job.retry(existing.operation_id)
            else:
                operation_id = str(uuid.uuid4())
                saved = await uow.job.add(BackgroundJob(
                    operation_id=operation_id, kind=OperationKind.SEMANTIC_INDEX, retry_supported=True,
                    scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
                    payload={"workspace_id": workspace_id, "source_generation": pub.generation, "embedding_config": config},
                    idempotency_key=f"semantic_index:{workspace_id}:{operation_id}",
                    progress=OperationProgress(completed=0, total=None),
                ))
                pub.semantic_operation_id = saved.operation_id
                await uow.document.save_publication(pub)
        self.wake()
        return saved

    async def on_component_available(self, component_id: str) -> None:
        """组件装好后：OCR 重入待解析；Embedding 为各工作区排队语义索引。"""
        if component_id == OCR_COMPONENT_ID and self._document_index is not None:
            await self._document_index.reconcile_ocr()
        elif component_id == EMBEDDING_COMPONENT_ID:
            await self._enqueue_all_workspaces()

    async def _enqueue_all_workspaces(self) -> None:
        async with self._read_uow_factory() as uow:
            workspace_ids = await uow.document.list_publication_workspace_ids()
        for workspace_id in workspace_ids:
            await self.enqueue(workspace_id)

    @staticmethod
    def _rows(embedder: E5OnnxEmbedder, chunks, generation: int) -> list[dict]:
        rows = []
        for chunk in chunks:
            parts = embedder.passage_parts(chunk.body)
            if not parts:
                continue
            # L2 归一化后求和与取均值等价。每段都进入编码，分批累加避免保留所有向量。
            accumulator = embedder.embed_passages(parts[:EMBEDDING_BATCH_SIZE]).sum(axis=0, keepdims=True)
            for start in range(EMBEDDING_BATCH_SIZE, len(parts), EMBEDDING_BATCH_SIZE):
                vectors = embedder.embed_passages(parts[start:start + EMBEDDING_BATCH_SIZE])
                accumulator += vectors.sum(axis=0, keepdims=True)
            vector = l2_normalize(accumulator)[0]
            rows.append({
                "chunk_id": chunk.id, "document_id": chunk.document_id,
                "revision_id": chunk.revision_id, "revision": chunk.revision,
                "generation": generation, "text_hash": chunk.text_hash, "vector": vector,
            })
        return rows

    @staticmethod
    async def _run_blocking(call, *args):
        # 取消时等当前批次收尾，再释放执行配额和写入归属。
        task = asyncio.create_task(asyncio.to_thread(call, *args))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await asyncio.gather(task, return_exceptions=True)
            raise

    async def process_workspace(self, context: JobContext) -> dict:
        workspace_id = context.job.payload["workspace_id"]
        await context.check_cancel()
        async with self._read_uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id)
            if not pub or pub.semantic_operation_id != context.job.operation_id or not await self._eligible(uow, pub):
                return {"status": "skipped", "reason": "inactive"}
            total = await uow.document.count_published_chunks(workspace_id)
        config = await self.active_config()
        embedder = await self._embedder_or_none(config) if config is not None else None
        if embedder is None:
            raise RuntimeError("语义检索组件不可用")

        store = self.store_for(workspace_id, config)
        generation = pub.generation
        await context.progress(phase="建立语义索引", completed=0, total=total)
        table = await self._run_blocking(store.begin_rebuild)
        after, completed, indexed = "", 0, 0
        while True:
            await context.check_cancel()
            async with self._read_uow_factory() as uow:
                current = await uow.document.get_publication(workspace_id)
                if not current or current.semantic_operation_id != context.job.operation_id or not await self._eligible(uow, current):
                    return {"status": "skipped", "reason": "inactive"}
                if current.generation != generation:
                    break
                chunks = await uow.document.published_chunk_page(workspace_id, after=after, limit=SEMANTIC_INDEX_CHUNK_BATCH)
            if not chunks:
                break
            async with self._compute_slot:
                rows = await self._run_blocking(self._rows, embedder, chunks, generation)
            await context.check_cancel()
            await self._run_blocking(store.append_rows, table, rows)
            indexed += len(rows)
            completed += len(chunks)
            after = chunks[-1].id
            await context.progress(completed=completed, total=total)

        version = await asyncio.to_thread(lambda: int(table.version))
        if completed == total:
            await asyncio.to_thread(store.open_at_version, version)
        async with self._uow_factory() as uow:
            await context.check_cancel_in(uow)
            current = await uow.document.get_publication(workspace_id)
            if not current or current.semantic_operation_id != context.job.operation_id or not await self._eligible(uow, current):
                return {"status": "skipped", "reason": "inactive"}
            if current.generation == generation and config == await self.active_config() and completed == total:
                current.embedding_config = config
                current.vector_generation = generation
                current.vector_table_version = version
                await uow.document.save_publication(current)
                return {"status": "ok", "chunks": indexed, "generation": generation, "table_version": version}
            # 旧任务已停止写表；释放排队归属后，让新的任务取得新快照。
            current.semantic_operation_id = None
            await uow.document.save_publication(current)
        await self.enqueue(workspace_id)
        return {"status": "skipped", "reason": "source_changed"}


def semantic_index_handler(service: SemanticIndexService):
    async def handle(context: JobContext) -> dict:
        return await service.process_workspace(context)
    return handle
