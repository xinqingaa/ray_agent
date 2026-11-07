"""文档登记、增量同步与索引发布编排。

每工作区串行发布：同一时刻最多一个 DOCUMENT_INDEX 任务；解析产物先写暂存块／片段，
短事务内切换权威可见并写入 FTS，取消与失败不发布半份。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Callable, Optional

from app.application.services.background_jobs import JobCancelled, JobContext, JobSuperseded, get_job_runner
from app.application.services.retrieval_service import RetrievalService
from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.document_knowledge import (
    CHUNK_CONFIG_FINGERPRINT,
    DOCUMENT_PARSE_MAX_BYTES,
    PARSE_CONFIG_FINGERPRINT,
    DocumentFormat,
    DocumentIndexStatus,
    DocumentRecord,
    DocumentRevision,
    IndexPublication,
    WorkspaceIndexSummary,
)
from app.domain.models.identity import RootedPath
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind
from app.domain.models.workspace import WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.document_formats import detect_format, is_indexable
from app.infrastructure.external.document_parse.chunking import blocks_from_worker, chunk_blocks
from app.infrastructure.external.document_parse.runner import run_document_parse

logger = logging.getLogger(__name__)

PENDING_STATUSES = (
    DocumentIndexStatus.PENDING_PARSE,
    DocumentIndexStatus.PARSING,
    DocumentIndexStatus.INDEXING,
)


class DocumentIndexService:

    def __init__(
            self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
            folder_access, files, retrieval: RetrievalService, *, wake: Optional[Callable[[], None]] = None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._folders = folder_access
        self._files = files
        self._retrieval = retrieval
        self._wake = wake

    def wake(self) -> None:
        if self._wake is not None:
            self._wake()
        else:
            try:
                get_job_runner().wake()
            except RuntimeError:
                pass

    async def summary(self, workspace_id: str) -> WorkspaceIndexSummary:
        async with self._read_uow_factory() as uow:
            return await uow.document.summary(workspace_id)

    async def list_documents(self, workspace_id: str) -> list[DocumentRecord]:
        async with self._read_uow_factory() as uow:
            return await uow.document.list_workspace(workspace_id)

    async def get_chunk_source(self, workspace_id: str, chunk_id: str) -> Optional[dict]:
        """工具与界面读回来源：片段正文与定位；非本工作区或不存在返回空。"""
        async with self._read_uow_factory() as uow:
            chunk = await uow.document.get_chunk(chunk_id)
            if chunk is None or chunk.workspace_id != workspace_id or not chunk.published:
                return None
            doc = await uow.document.get(chunk.document_id)
            rev = await uow.document.get_revision(chunk.revision_id)
            return {
                "source_type": "document_chunk",
                "source_id": chunk.id,
                "document_id": chunk.document_id,
                "revision": chunk.revision,
                "relative_path": doc.relative_path if doc else (rev.relative_path if rev else ""),
                "title": chunk.title,
                "body": chunk.body,
                "locator": dict(chunk.locator),
                "stale": bool(doc and doc.current_revision != chunk.revision),
            }

    async def sync_workspace(self, workspace_id: str, *, paths: Optional[set[str]] = None) -> dict:
        """对照文件夹快照登记／更新／撤回文档，并在有待处理修订时排队索引任务。"""
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            root = await uow.root.workspace_folder(workspace_id)
        if workspace is None or workspace.status is not WorkspaceStatus.ACTIVE or root is None:
            return {"status": "skipped", "reason": "workspace_unavailable"}

        snapshot = await self._files.snapshot(RootedPath(root_id=root.ref.root_id, relative_path=""))
        # paths 过滤：变更通知可能带目录；只处理快照里仍存在或明确删除的路径
        if paths is not None:
            target_paths = set(paths)
            # 扩展：若通知是目录前缀，匹配其下文件
            expanded = set()
            for path in target_paths:
                if path in snapshot.files:
                    expanded.add(path)
                else:
                    prefix = path.rstrip("/") + "/"
                    expanded.update(p for p in snapshot.files if p == path or p.startswith(prefix))
            # 已登记但通知涉及且快照中消失的也要处理
            async with self._read_uow_factory() as uow:
                registered = await uow.document.list_workspace(workspace_id)
            for doc in registered:
                if doc.relative_path in target_paths or any(
                        doc.relative_path.startswith(p.rstrip("/") + "/") for p in target_paths):
                    expanded.add(doc.relative_path)
            seen_filter = expanded
        else:
            seen_filter = set(snapshot.files.keys())

        registered_count = withdrawn = queued = 0
        async with self._uow_factory() as uow:
            existing = {d.relative_path: d for d in await uow.document.list_workspace(workspace_id)}
            # 撤回：全量同步时快照中消失的；增量时在 filter 内且消失的
            for path, doc in list(existing.items()):
                if paths is None:
                    gone = path not in snapshot.files
                else:
                    gone = path in seen_filter and path not in snapshot.files
                if gone and doc.status is not DocumentIndexStatus.WITHDRAWN:
                    await self._withdraw(uow, doc)
                    withdrawn += 1

            for path in (snapshot.files.keys() if paths is None else seen_filter):
                if path not in snapshot.files:
                    continue
                size, modified_ns = snapshot.files[path]
                fmt = detect_format(path)
                doc = existing.get(path)
                if doc is None:
                    doc = DocumentRecord(
                        id=str(uuid.uuid4()), workspace_id=workspace_id, relative_path=path,
                        current_revision=0, status=DocumentIndexStatus.REGISTERED, format=fmt)
                    await uow.document.save(doc)
                    existing[path] = doc
                    registered_count += 1
                # 轻量比对：大小与 mtime；变化后再算内容哈希
                current = await uow.document.get_revision_by_number(doc.id, doc.current_revision) \
                    if doc.current_revision else None
                if current and current.size == size and current.modified_ns == modified_ns \
                        and current.status is DocumentIndexStatus.SEARCHABLE:
                    continue
                if size > DOCUMENT_PARSE_MAX_BYTES and is_indexable(fmt):
                    # 过大：登记失败修订，不解析
                    await self._open_revision(uow, doc, content_hash="oversized", size=size,
                                             modified_ns=modified_ns, fmt=fmt,
                                             status=DocumentIndexStatus.FAILED,
                                             error="文件超过解析大小上限")
                    continue
                try:
                    entry = await self._files.stat(
                        RootedPath(root_id=root.ref.root_id, relative_path=path), with_hash=True)
                except Exception as error:  # noqa: BLE001
                    logger.info("读取文件哈希失败 workspace=%s path=%s: %s", workspace_id, path, error)
                    continue
                content_hash = entry.version.content_hash if entry.version else None
                if not content_hash:
                    continue
                if current and current.content_hash == content_hash and current.status in (
                        DocumentIndexStatus.SEARCHABLE, DocumentIndexStatus.PENDING_COMPONENT,
                        DocumentIndexStatus.PENDING_PARSE, DocumentIndexStatus.PARSING,
                        DocumentIndexStatus.INDEXING):
                    # 同哈希且已在处理或完成：跳过
                    if current.size != size or current.modified_ns != modified_ns:
                        current.size, current.modified_ns = size, modified_ns
                        current.updated_at = utc_now()
                        await uow.document.save_revision(current)
                    continue
                if not is_indexable(fmt):
                    await self._open_revision(
                        uow, doc, content_hash=content_hash, size=size, modified_ns=modified_ns, fmt=fmt,
                        status=DocumentIndexStatus.FAILED, error="不支持的文件格式")
                    continue
                status = DocumentIndexStatus.PENDING_COMPONENT if fmt is DocumentFormat.IMAGE \
                    else DocumentIndexStatus.PENDING_PARSE
                component = "ocr" if status is DocumentIndexStatus.PENDING_COMPONENT else None
                await self._open_revision(
                    uow, doc, content_hash=content_hash, size=size, modified_ns=modified_ns, fmt=fmt,
                    status=status, component=component)
                if status is DocumentIndexStatus.PENDING_PARSE:
                    queued += 1

            job = await self._ensure_job(uow, workspace_id)
        if job is not None:
            self.wake()
        return {
            "status": "ok", "registered": registered_count, "withdrawn": withdrawn,
            "pending_parse": queued, "truncated": snapshot.truncated,
            "operation_id": job.operation_id if job else None,
        }

    async def _open_revision(
            self, uow: IUnitOfWork, doc: DocumentRecord, *, content_hash: str, size: int, modified_ns: int,
            fmt: DocumentFormat, status: DocumentIndexStatus, error: Optional[str] = None,
            component: Optional[str] = None,
    ) -> DocumentRevision:
        revision_no = doc.current_revision + 1
        # 新修订可见前先撤回旧索引，避免旧片段冒充当前原文
        if doc.current_revision > 0:
            chunk_ids = await uow.document.unpublish_document(doc.id)
            for chunk_id in chunk_ids:
                await self._retrieval.remove_document_chunk(uow, doc.workspace_id, chunk_id)
        rev = DocumentRevision(
            id=str(uuid.uuid4()), document_id=doc.id, workspace_id=doc.workspace_id,
            revision=revision_no, relative_path=doc.relative_path, content_hash=content_hash,
            size=size, modified_ns=modified_ns, status=status, format=fmt,
            parse_config=PARSE_CONFIG_FINGERPRINT, chunk_config=CHUNK_CONFIG_FINGERPRINT,
            error_message=error, component_needed=component,
        )
        await uow.document.add_revision(rev)
        doc.current_revision = revision_no
        doc.status = status
        doc.format = fmt
        doc.updated_at = utc_now()
        await uow.document.save(doc)
        return rev

    async def _withdraw(self, uow: IUnitOfWork, doc: DocumentRecord) -> None:
        chunk_ids = await uow.document.unpublish_document(doc.id)
        for chunk_id in chunk_ids:
            await self._retrieval.remove_document_chunk(uow, doc.workspace_id, chunk_id)
        doc.status = DocumentIndexStatus.WITHDRAWN
        doc.updated_at = utc_now()
        await uow.document.save(doc)
        if doc.current_revision:
            rev = await uow.document.get_revision_by_number(doc.id, doc.current_revision)
            if rev is not None:
                rev.status = DocumentIndexStatus.WITHDRAWN
                rev.updated_at = utc_now()
                await uow.document.save_revision(rev)

    async def _ensure_job(self, uow: IUnitOfWork, workspace_id: str) -> Optional[BackgroundJob]:
        pending = await uow.document.list_revisions_by_status(
            workspace_id, [DocumentIndexStatus.PENDING_PARSE, DocumentIndexStatus.INDEXING], limit=1)
        if not pending:
            return None
        # 同工作区已有排队／运行中的索引任务则不重复登记（用发布指针上的 operation_id）
        pub = await uow.document.get_publication(workspace_id)
        if pub is not None and pub.active_operation_id:
            existing = await uow.job.get(pub.active_operation_id)
            if existing is not None and not existing.status.terminal:
                return existing
        operation_id = str(uuid.uuid4())
        job = BackgroundJob(
            operation_id=operation_id, kind=OperationKind.DOCUMENT_INDEX, retry_supported=True,
            scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
            payload={"workspace_id": workspace_id},
            # 幂等键带 operation_id：完成后仍可再排队；串行靠 active_operation_id
            idempotency_key=f"document_index:{workspace_id}:{operation_id}",
            progress=OperationProgress(completed=0, total=None),
        )
        saved = await uow.job.add(job)
        pub = pub or IndexPublication(workspace_id=workspace_id)
        pub.status = "publishing"
        pub.active_operation_id = saved.operation_id
        pub.updated_at = utc_now()
        pub.last_error = None
        await uow.document.save_publication(pub)
        return saved

    async def _clear_publication(self, workspace_id: str, operation_id: str, *, error: Optional[str] = None) -> None:
        async with self._uow_factory() as uow:
            pub = await uow.document.get_publication(workspace_id)
            if pub is None or pub.active_operation_id != operation_id:
                return
            pub.status = "failed" if error else "idle"
            pub.active_operation_id = None
            pub.last_error = error
            pub.updated_at = utc_now()
            await uow.document.save_publication(pub)

    async def process_workspace(self, context: JobContext) -> dict:
        """DOCUMENT_INDEX 处理：串行解析并发布本工作区待处理修订。"""
        workspace_id = context.job.payload["workspace_id"]
        processed = failed = skipped = 0
        try:
            while True:
                await context.check_cancel()
                async with self._uow_factory() as uow:
                    batch = await uow.document.list_revisions_by_status(
                        workspace_id, [DocumentIndexStatus.PENDING_PARSE], limit=5)
                    if not batch:
                        break
                for rev in batch:
                    await context.check_cancel()
                    await context.progress(phase=f"解析 {rev.relative_path}", completed=processed + failed)
                    try:
                        outcome = await self._parse_and_publish(context, rev)
                    except JobCancelled:
                        raise
                    except JobSuperseded:
                        raise
                    except Exception as error:  # noqa: BLE001
                        logger.exception("文档索引失败 revision=%s", rev.id)
                        async with self._uow_factory() as uow:
                            current = await uow.document.get_revision(rev.id)
                            if current is not None:
                                current.status = DocumentIndexStatus.FAILED
                                current.error_message = str(error) or type(error).__name__
                                current.updated_at = utc_now()
                                await uow.document.save_revision(current)
                                doc = await uow.document.get(current.document_id)
                                if doc and doc.current_revision == current.revision:
                                    doc.status = DocumentIndexStatus.FAILED
                                    doc.updated_at = utc_now()
                                    await uow.document.save(doc)
                        failed += 1
                        continue
                    if outcome == "ok":
                        processed += 1
                    elif outcome == "skipped":
                        skipped += 1
                    else:
                        failed += 1
            await self._clear_publication(workspace_id, context.job.operation_id)
            return {"processed": processed, "failed": failed, "skipped": skipped}
        except JobCancelled:
            await self._clear_publication(workspace_id, context.job.operation_id, error="已取消")
            raise
        except JobSuperseded:
            raise
        except Exception as error:
            await self._clear_publication(workspace_id, context.job.operation_id,
                                          error=str(error) or type(error).__name__)
            raise

    async def _parse_and_publish(self, context: JobContext, rev: DocumentRevision) -> str:
        async with self._read_uow_factory() as uow:
            root = await uow.root.workspace_folder(rev.workspace_id)
            doc = await uow.document.get(rev.document_id)
        if root is None or doc is None:
            return "skipped"
        if doc.current_revision != rev.revision:
            # 已被更新修订取代
            async with self._uow_factory() as uow:
                current = await uow.document.get_revision(rev.id)
                if current and current.status is DocumentIndexStatus.PENDING_PARSE:
                    current.status = DocumentIndexStatus.WITHDRAWN
                    current.updated_at = utc_now()
                    await uow.document.save_revision(current)
            return "skipped"

        async with self._uow_factory() as uow:
            current = await uow.document.get_revision(rev.id)
            if current is None or current.status is not DocumentIndexStatus.PENDING_PARSE:
                return "skipped"
            current.status = DocumentIndexStatus.PARSING
            current.updated_at = utc_now()
            await uow.document.save_revision(current)
            if doc.current_revision == rev.revision:
                doc.status = DocumentIndexStatus.PARSING
                doc.updated_at = utc_now()
                await uow.document.save(doc)

        cancel = asyncio.Event()
        aborted = False

        async def watch_cancel() -> None:
            nonlocal aborted
            while not cancel.is_set():
                try:
                    await context.check_cancel()
                except JobCancelled:
                    aborted = True
                    cancel.set()
                    return
                except JobSuperseded:
                    aborted = True
                    cancel.set()
                    return
                await asyncio.sleep(0.4)

        watcher = asyncio.create_task(watch_cancel())
        try:
            # 拷到临时文件再解析，读前后核哈希
            with tempfile.TemporaryDirectory(prefix="rayagent-doc-src-") as tmp:
                src = Path(tmp) / Path(rev.relative_path).name
                reader = await self._files.open_reader(
                    RootedPath(root_id=root.ref.root_id, relative_path=rev.relative_path))
                digest = hashlib.sha256()

                def copy() -> int:
                    size = 0
                    with reader, open(src, "wb") as out:
                        while True:
                            chunk = reader.read(1024 * 1024)
                            if not chunk:
                                break
                            digest.update(chunk)
                            out.write(chunk)
                            size += len(chunk)
                            if size > DOCUMENT_PARSE_MAX_BYTES:
                                raise ValueError("文件超过解析大小上限")
                    return size

                try:
                    size = await asyncio.to_thread(copy)
                except Exception as error:  # noqa: BLE001
                    await self._fail_revision(rev, str(error))
                    return "failed"
                content_hash = digest.hexdigest()
                if content_hash != rev.content_hash:
                    # 正在变化：延后，恢复 pending 等下次同步
                    async with self._uow_factory() as uow:
                        current = await uow.document.get_revision(rev.id)
                        if current and current.status is DocumentIndexStatus.PARSING:
                            current.status = DocumentIndexStatus.PENDING_PARSE
                            current.updated_at = utc_now()
                            current.error_message = "读取时内容已变化，已延后"
                            await uow.document.save_revision(current)
                    return "skipped"

                result = await run_document_parse(src, rev.format.value, cancel_event=cancel)
        except asyncio.CancelledError:
            aborted = True
            raise
        finally:
            cancel.set()
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

        if aborted:
            # 取消或 superseded：不发布半份
            async with self._uow_factory() as uow:
                current = await uow.document.get_revision(rev.id)
                if current and current.status is DocumentIndexStatus.PARSING:
                    current.status = DocumentIndexStatus.PENDING_PARSE
                    current.updated_at = utc_now()
                    await uow.document.save_revision(current)
            await context.check_cancel()
            return "skipped"

        status = result.get("status")
        if status == "pending_component":
            async with self._uow_factory() as uow:
                current = await uow.document.get_revision(rev.id)
                if current is None:
                    return "skipped"
                current.status = DocumentIndexStatus.PENDING_COMPONENT
                current.component_needed = result.get("component_needed") or "ocr"
                current.error_message = result.get("reason")
                current.updated_at = utc_now()
                await uow.document.save_revision(current)
                document = await uow.document.get(rev.document_id)
                if document and document.current_revision == rev.revision:
                    document.status = DocumentIndexStatus.PENDING_COMPONENT
                    document.updated_at = utc_now()
                    await uow.document.save(document)
            return "ok"

        if status != "ok":
            await self._fail_revision(rev, result.get("reason") or "解析失败")
            return "failed"

        # 写入不可见暂存块／片段，再短事务发布
        async with self._uow_factory() as uow:
            current = await uow.document.get_revision(rev.id)
            document = await uow.document.get(rev.document_id)
            if current is None or document is None or document.current_revision != rev.revision:
                return "skipped"
            if current.status is not DocumentIndexStatus.PARSING:
                return "skipped"
            current.status = DocumentIndexStatus.INDEXING
            current.updated_at = utc_now()
            await uow.document.save_revision(current)
            blocks = blocks_from_worker(result, revision_id=current.id, workspace_id=current.workspace_id)
            await uow.document.replace_blocks(current.id, blocks)
            chunks = chunk_blocks(
                blocks, document_id=document.id, revision_id=current.id,
                workspace_id=current.workspace_id, revision=current.revision,
                title=Path(current.relative_path).name)
            await uow.document.replace_chunks(current.id, chunks)

        await context.check_cancel()

        # 发布：权威可见 + FTS；同工作区串行由本任务保证
        async with self._uow_factory() as uow:
            current = await uow.document.get_revision(rev.id)
            document = await uow.document.get(rev.document_id)
            if current is None or document is None or document.current_revision != rev.revision:
                return "skipped"
            if current.status is not DocumentIndexStatus.INDEXING:
                return "skipped"
            chunks = await uow.document.list_chunks(current.id)
            # 先确保旧片段已从 FTS 移除（开修订时已做；再扫一遍防半份）
            old_ids = await uow.document.unpublish_document(document.id)
            for chunk_id in old_ids:
                await self._retrieval.remove_document_chunk(uow, document.workspace_id, chunk_id)
            for chunk in chunks:
                chunk.published = True
                await self._retrieval.index_document_chunk(uow, chunk, relative_path=document.relative_path)
            await uow.document.replace_chunks(current.id, chunks)
            await uow.document.mark_chunks_published(current.id, True)
            current.status = DocumentIndexStatus.SEARCHABLE
            current.published_at = utc_now()
            current.updated_at = utc_now()
            current.error_message = None
            await uow.document.save_revision(current)
            document.status = DocumentIndexStatus.SEARCHABLE
            document.updated_at = utc_now()
            await uow.document.save(document)
            pub = await uow.document.get_publication(document.workspace_id) or IndexPublication(
                workspace_id=document.workspace_id)
            pub.generation += 1
            pub.status = "publishing"
            pub.updated_at = utc_now()
            await uow.document.save_publication(pub)
        return "ok"

    async def _fail_revision(self, rev: DocumentRevision, message: str) -> None:
        async with self._uow_factory() as uow:
            current = await uow.document.get_revision(rev.id)
            if current is None:
                return
            current.status = DocumentIndexStatus.FAILED
            current.error_message = message[:1000]
            current.updated_at = utc_now()
            await uow.document.save_revision(current)
            doc = await uow.document.get(current.document_id)
            if doc and doc.current_revision == current.revision:
                doc.status = DocumentIndexStatus.FAILED
                doc.updated_at = utc_now()
                await uow.document.save(doc)


def document_index_handler(service: DocumentIndexService):
    async def handle(context: JobContext) -> dict:
        return await service.process_workspace(context)
    return handle
