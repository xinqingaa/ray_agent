"""语义索引：将已发布 chunks 写入 LanceDB，对齐 index_publications.generation。

组件缺失或失败时不阻塞 FTS；配置／模型变化使用独立索引空间。
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Callable, Optional

from app.application.services.background_jobs import JobCancelled, JobContext, JobSuperseded, get_job_runner
from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.document_knowledge import IndexPublication
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind
from app.domain.models.semantic_index import (
    EMBEDDING_COMPONENT_ID,
    EMBEDDING_CONFIG_FINGERPRINT,
    OCR_COMPONENT_ID,
    SEMANTIC_INDEX_CHUNK_BATCH,
)
from app.domain.repositories.uow import IUnitOfWork
from app.infrastructure.external.embedding.e5_onnx import E5OnnxEmbedder
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

    async def ocr_available(self) -> bool:
        if self._components is None:
            return False
        try:
            status = await self._components.status(OCR_COMPONENT_ID)
            return status.state.value == "available"
        except Exception:  # noqa: BLE001
            return False

    async def _embedder_or_none(self) -> E5OnnxEmbedder | None:
        if not await self.embedding_available():
            return None
        if self._embedder is not None and self._components is None:
            return self._embedder
        if self._components is None:
            return self._embedder
        path = await self._components.locate(EMBEDDING_COMPONENT_ID)
        if self._embedder is None or Path(self._embedder.root) != path:
            self._embedder = E5OnnxEmbedder(path)
        return self._embedder

    def store_for(self, workspace_id: str, embedding_config: str = EMBEDDING_CONFIG_FINGERPRINT) -> LanceChunkStore:
        return LanceChunkStore(self._indexes_root(), workspace_id, embedding_config)

    async def enqueue(self, workspace_id: str) -> Optional[BackgroundJob]:
        """Embedding 可用时为工作区登记 SEMANTIC_INDEX；已有未完成任务则复用。"""
        if not await self.embedding_available():
            return None
        async with self._uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
            if pub.semantic_operation_id:
                existing = await uow.job.get(pub.semantic_operation_id)
                if existing is not None and not existing.status.terminal:
                    return existing
            # 已对齐当前 generation 则无需重建
            if pub.vector_generation is not None and pub.vector_generation == pub.generation and pub.generation > 0:
                if (pub.embedding_config or EMBEDDING_CONFIG_FINGERPRINT) == EMBEDDING_CONFIG_FINGERPRINT:
                    return None
            operation_id = str(uuid.uuid4())
            job = BackgroundJob(
                operation_id=operation_id, kind=OperationKind.SEMANTIC_INDEX, retry_supported=True,
                scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
                payload={"workspace_id": workspace_id},
                idempotency_key=f"semantic_index:{workspace_id}:{operation_id}",
                progress=OperationProgress(completed=0, total=None),
            )
            saved = await uow.job.add(job)
            pub.semantic_operation_id = saved.operation_id
            pub.status = "semantic_indexing"
            pub.updated_at = utc_now()
            pub.last_error = None
            if not pub.embedding_config:
                pub.embedding_config = EMBEDDING_CONFIG_FINGERPRINT
            await uow.document.save_publication(pub)
        self.wake()
        return saved

    async def on_component_available(self, component_id: str) -> None:
        """组件装好后：OCR 重入待解析；Embedding 为各工作区排队语义索引。"""
        if component_id == OCR_COMPONENT_ID:
            await self._requeue_pending_ocr()
        elif component_id == EMBEDDING_COMPONENT_ID:
            await self._enqueue_all_workspaces()

    async def _requeue_pending_ocr(self) -> None:
        """把 pending_component=ocr 的当前修订改回 pending_parse 并唤醒文档索引。"""
        from app.domain.models.document_knowledge import DocumentIndexStatus
        async with self._uow_factory() as uow:
            revisions = await uow.document.list_pending_component(component="ocr")
            workspace_ids: set[str] = set()
            for rev in revisions:
                doc = await uow.document.get(rev.document_id)
                if doc is None or doc.current_revision != rev.revision:
                    continue
                rev.status = DocumentIndexStatus.PENDING_PARSE
                rev.component_needed = None
                rev.error_message = None
                rev.updated_at = utc_now()
                await uow.document.save_revision(rev)
                doc.status = DocumentIndexStatus.PENDING_PARSE
                doc.updated_at = utc_now()
                await uow.document.save(doc)
                workspace_ids.add(rev.workspace_id)
            for workspace_id in workspace_ids:
                if self._document_index is not None:
                    await self._document_index._ensure_job(uow, workspace_id)  # noqa: SLF001
        self.wake()

    async def _enqueue_all_workspaces(self) -> None:
        async with self._read_uow_factory() as uow:
            workspace_ids = await uow.document.list_publication_workspace_ids()
        for workspace_id in workspace_ids:
            await self.enqueue(workspace_id)

    async def process_workspace(self, context: JobContext) -> dict:
        workspace_id = context.job.payload["workspace_id"]
        embedder = await self._embedder_or_none()
        if embedder is None:
            await self._clear_semantic(workspace_id, context.job.operation_id,
                                       error="Embedding 组件不可用")
            return {"status": "skipped", "reason": "embedding_unavailable"}

        try:
            await context.check_cancel()
            async with self._read_uow_factory() as uow:
                pub = await uow.document.get_publication(workspace_id)
                chunks = await uow.document.list_published_chunks(workspace_id)
            if pub is None:
                await self._clear_semantic(workspace_id, context.job.operation_id)
                return {"status": "skipped", "reason": "no_publication"}

            generation = pub.generation
            embedding_config = pub.embedding_config or EMBEDDING_CONFIG_FINGERPRINT
            if embedding_config != EMBEDDING_CONFIG_FINGERPRINT:
                # 配置变更：新空间，不混查旧表
                store = self.store_for(workspace_id, embedding_config)
            else:
                store = self.store_for(workspace_id, EMBEDDING_CONFIG_FINGERPRINT)

            rows = []
            total = len(chunks)
            for start in range(0, total, SEMANTIC_INDEX_CHUNK_BATCH):
                await context.check_cancel()
                batch = chunks[start:start + SEMANTIC_INDEX_CHUNK_BATCH]
                await context.progress(phase=f"语义索引 {start}/{total}", completed=start, total=total)
                texts: list[str] = []
                meta: list = []
                for chunk in batch:
                    parts = embedder.passage_parts(chunk.body)
                    # 多段时分别入库会改变身份；首批对超长片段拼接各段向量均值前先取首段，
                    # 同时把后续段以同一 chunk_id 不重复写入——按计划不可只截断声称整段入库。
                    # 做法：各段分别编码后均值池化为一条向量。
                    if not parts:
                        continue
                    texts.append(parts[0] if len(parts) == 1 else "\n".join(parts))
                    meta.append(chunk)
                if not texts:
                    continue
                # 对超长：逐条多段均值
                vectors = []
                for text, chunk in zip(texts, meta):
                    parts = embedder.passage_parts(chunk.body)
                    if len(parts) <= 1:
                        vectors.append(embedder.embed_passages(parts or [text])[0])
                    else:
                        import numpy as np
                        mat = embedder.embed_passages(parts)
                        vectors.append(mat.mean(axis=0))
                        # 再归一化
                        from app.infrastructure.external.embedding.e5_onnx import l2_normalize
                        vectors[-1] = l2_normalize(vectors[-1].reshape(1, -1))[0]
                for chunk, vector in zip(meta, vectors):
                    rows.append({
                        "chunk_id": chunk.id,
                        "document_id": chunk.document_id,
                        "revision_id": chunk.revision_id,
                        "revision": chunk.revision,
                        "generation": generation,
                        "text_hash": chunk.text_hash,
                        "vector": vector,
                    })

            await context.check_cancel()
            table_version = store.replace_generation(generation, rows)

            async with self._uow_factory() as uow:
                current = await uow.document.get_publication(workspace_id)
                if current is None or current.semantic_operation_id != context.job.operation_id:
                    raise JobSuperseded("语义索引操作已被取代")
                # 若 FTS generation 已前进，只发布我们写入时的代次；下次再增量
                current.embedding_config = embedding_config
                current.vector_generation = generation
                current.vector_table_version = table_version
                current.semantic_operation_id = None
                current.status = "idle"
                current.updated_at = utc_now()
                current.last_error = None
                await uow.document.save_publication(current)
                # generation 已变则再排队
                need_again = current.generation != generation
            if need_again:
                await self.enqueue(workspace_id)
            return {"status": "ok", "chunks": len(rows), "generation": generation,
                    "table_version": table_version}
        except JobCancelled:
            await self._clear_semantic(workspace_id, context.job.operation_id, error="已取消")
            raise
        except JobSuperseded:
            raise
        except Exception as error:
            await self._clear_semantic(workspace_id, context.job.operation_id,
                                       error=str(error) or type(error).__name__)
            raise

    async def _clear_semantic(self, workspace_id: str, operation_id: str, *, error: Optional[str] = None) -> None:
        async with self._uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id)
            if pub is None or pub.semantic_operation_id != operation_id:
                return
            pub.semantic_operation_id = None
            pub.status = "failed" if error else "idle"
            pub.last_error = error
            pub.updated_at = utc_now()
            await uow.document.save_publication(pub)


def semantic_index_handler(service: SemanticIndexService):
    async def handle(context: JobContext) -> dict:
        return await service.process_workspace(context)
    return handle
