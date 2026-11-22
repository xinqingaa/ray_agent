"""登记文档、恢复解析任务，并原子发布片段和全文索引。"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Callable

from app.application.errors.exceptions import BadRequestError, ConflictError, GoneError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.application.services.background_jobs import JobCancelled, JobContext, JobSuperseded, get_job_runner
from app.application.services.retrieval_service import RetrievalService
from app.domain.external.workspace_files import FileKind, RootBinding, WorkspaceFileError
from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.document_knowledge import (
    AgentOutputPolicy, CHUNK_CONFIG_FINGERPRINT, DOCUMENT_PARSE_MAX_BYTES,
    DOCUMENT_SCOPE_REVIEW_BYTES, DOCUMENT_SCOPE_REVIEW_FILES, PARSE_CONFIG_FINGERPRINT,
    DocumentCategory, DocumentFormat, DocumentIndexStatus as Status, DocumentLocator, DocumentOcrState, DocumentRecord,
    DocumentRevision, IndexDirectorySize, IndexPolicy, IndexPublication, IndexScope, WorkspaceIndexSummary,
    excluded_directory, policy_decision,
)
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind
from app.domain.models.retrieval import SearchHit, SearchSourceType
from app.domain.models.workspace import FolderStatus, RootRecord, WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.document_formats import category_of, detect_format
from app.infrastructure.external.document_parse.chunking import blocks_from_worker, chunk_blocks
from app.infrastructure.external.document_parse.runner import run_document_parse

logger = logging.getLogger(__name__)

IN_PROGRESS = (Status.PARSING, Status.INDEXING)
PENDING = (Status.PENDING_PARSE, *IN_PROGRESS)
RETIRED = (Status.WITHDRAWN, Status.EXCLUDED)


class _IndexStopped(Exception):
    """调度策略或文件夹状态暂不允许处理。"""


def _binding(root: RootRecord | None) -> tuple | None:
    return (root.ref.root_id, root.dev, root.ino, root.location) if root else None


async def _remove_search_chunks(uow: IUnitOfWork, workspace_id: str, chunk_ids: list[str]) -> None:
    if not chunk_ids:
        return
    if hasattr(uow.search, "remove_many"):
        await uow.search.remove_many(
            workspace_id=workspace_id,
            source_type=SearchSourceType.DOCUMENT_CHUNK,
            source_ids=chunk_ids,
        )
        return
    for chunk_id in chunk_ids:
        await uow.search.remove(
            workspace_id=workspace_id,
            source_type=SearchSourceType.DOCUMENT_CHUNK,
            source_id=chunk_id,
        )


async def _unpublish(uow: IUnitOfWork, doc: DocumentRecord, pub: IndexPublication) -> None:
    ids = await uow.document.unpublish_document(doc.id)
    await _remove_search_chunks(uow, doc.workspace_id, ids)
    if ids:
        pub.generation += 1


async def _retire_many(
        uow: IUnitOfWork, workspace_id: str, docs: list[DocumentRecord], pub: IndexPublication, status: Status,
) -> int:
    targets = [doc for doc in docs if doc.status is not status]
    if not targets:
        return 0
    if hasattr(uow.document, "unpublish_documents"):
        ids = await uow.document.unpublish_documents([doc.id for doc in targets])
    else:
        ids = []
        for doc in targets:
            ids.extend(await uow.document.unpublish_document(doc.id))
    await _remove_search_chunks(uow, workspace_id, ids)
    if ids:
        pub.generation += 1
    now = utc_now()
    if hasattr(uow.document, "retire_documents"):
        await uow.document.retire_documents(targets, status, now)
        return len(targets)
    for doc in targets:
        doc.source_epoch += 1
        doc.status = status
        doc.updated_at = now
        await uow.document.save(doc)
        if revision := await uow.document.get_revision_by_number(doc.id, doc.current_revision):
            revision.status = status
            revision.updated_at = now
            await uow.document.save_revision(revision)
    return len(targets)


async def _retire(uow: IUnitOfWork, doc: DocumentRecord, pub: IndexPublication, status: Status) -> None:
    await _retire_many(uow, doc.workspace_id, [doc], pub, status)


async def retire_document_binding(uow: IUnitOfWork, workspace_id: str) -> None:
    """改绑与旧来源撤回在同一个工作区事务中提交。"""
    pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
    await _retire_many(uow, workspace_id, await uow.document.list_workspace(workspace_id), pub, Status.WITHDRAWN)
    pub.scan = IndexScope()
    pub.policy.scope_confirmed = False
    pub.policy.version += 1
    pub.scope_review_required = False
    pub.scan_operation_id = None
    pub.updated_at = utc_now()
    await uow.document.save_publication(pub)


class DocumentIndexService:
    def __init__(
            self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
            folder_access, files, retrieval: RetrievalService, *, wake: Callable[[], None] | None = None,
            semantic=None, ocr_dir_probe: Callable[[], Path | None] | None = None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._files = files
        self._retrieval = retrieval
        self._wake = wake
        self._semantic = semantic
        self._ocr_dir_probe = ocr_dir_probe
        self._scan_lock = asyncio.Lock()

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
            summary = await uow.document.summary(workspace_id)
            if summary.active_operation_id:
                operation = await uow.job.get(summary.active_operation_id)
                if not operation or operation.status.terminal:
                    publication = await uow.document.get_publication(workspace_id)
                    alternative = publication.active_operation_id if publication else None
                    operation = await uow.job.get(alternative) if alternative else None
                    summary.active_operation_id = operation.operation_id if operation and not operation.status.terminal else None
            root = await uow.root.workspace_folder(workspace_id)
            summary.folder_available = bool(root and root.status is FolderStatus.AVAILABLE)
        if self._semantic is not None:
            summary.semantic = await self._semantic.summary(workspace_id)
            summary.semantic_ready = summary.semantic.state == "ready"
        return summary

    def _bound_files(self, root: RootRecord):
        return self._files.for_binding(RootBinding(root_id=root.ref.root_id, kind=root.ref.kind,
                                                  path=root.location, dev=root.dev, ino=root.ino))

    async def list_documents(self, workspace_id: str) -> list[DocumentRecord]:
        async with self._read_uow_factory() as uow:
            return await uow.document.list_workspace(workspace_id)

    async def page(self, workspace_id: str, *, after: str | None, limit: int):
        async with self._read_uow_factory() as uow:
            return await uow.document.page_workspace(workspace_id, after=after, limit=limit + 1)

    async def chunk_source(
            self, uow: IUnitOfWork, workspace_id: str, chunk_id: str, *,
            version: int | None = None, historical: bool = False, verify_hash: bool = False, presentation: bool = False,
    ) -> dict:
        chunk = await uow.document.get_chunk(chunk_id)
        if chunk is None or chunk.workspace_id != workspace_id or (version is not None and chunk.revision != version):
            raise NotFoundError("没有找到此版本的文件来源")
        doc = await uow.document.get(chunk.document_id)
        rev = await uow.document.get_revision(chunk.revision_id)
        if not doc or not rev or rev.published_at is None:
            raise NotFoundError("该片段未发布")
        if doc.status in RETIRED or rev.source_epoch != doc.source_epoch:
            raise GoneError("来源文件已删除、排除或移出原授权范围")
        root = await uow.root.workspace_folder(workspace_id)
        if root is None or root.status is not FolderStatus.AVAILABLE:
            raise GoneError("来源文件夹不可用")
        path = RootedPath(root_id=root.ref.root_id, relative_path=rev.relative_path)
        files = self._bound_files(root)
        try:
            entry = await files.stat(path)
            if entry.kind is not FileKind.FILE or entry.version is None:
                raise GoneError("来源路径已不再指向普通文件")
            matches = (entry.version.size, entry.version.modified_ns) == (rev.size, rev.modified_ns)
            if matches and verify_hash:
                hashed = await files.stat(path, with_hash=True)
                matches = bool(hashed.version and hashed.version.content_hash == rev.content_hash)
            with await files.open_reader(path, entry.version):
                pass
        except WorkspaceFileError as error:
            raise GoneError("来源文件已删除、无法访问或已移出原授权范围") from error
        stale = not (chunk.published and doc.current_revision == rev.revision and matches)
        if stale and not historical:
            raise GoneError("来源版本已更新，请重新检索")
        locator = DocumentLocator.model_validate(chunk.locator).model_dump(exclude_none=True)
        result = dict(source_type="document_chunk", source_id=chunk.id, document_id=doc.id,
                      revision=chunk.revision, relative_path=rev.relative_path, title=chunk.title,
                      format=rev.format, body=chunk.body, locator=locator, stale=stale,
                      root_id=root.ref.root_id, current_revision=doc.current_revision)
        if presentation and locator.get("rows"):
            result["cells"] = list(csv.reader(io.StringIO(chunk.body), delimiter="\t"))
        if presentation and not stale:
            from app.application.services.file_preview_service import root_preview_revision
            result["preview_revision"] = root_preview_revision(root.ref.root_id, entry)
        return result

    async def get_chunk_source(self, workspace_id: str, chunk_id: str) -> dict | None:
        """Agent 只读回当前可用的文档材料。"""
        async with self._read_uow_factory() as uow:
            try:
                return await self.chunk_source(uow, workspace_id, chunk_id, verify_hash=True)
            except (GoneError, NotFoundError):
                return None

    async def source(self, workspace_id: str, chunk_id: str, version: int | None) -> dict:
        async with self._read_uow_factory() as uow:
            return await self.chunk_source(uow, workspace_id, chunk_id, version=version,
                                           historical=True, verify_hash=True, presentation=True)

    async def visible_hits(self, workspace_id: str, hits: list[SearchHit]) -> list[SearchHit]:
        """撤回优先于索引。扫描尚未发现改名或删除时，也不能召回旧材料。"""
        if not any(hit.source_type is SearchSourceType.DOCUMENT_CHUNK for hit in hits):
            return hits
        visible = []
        async with self._read_uow_factory() as uow:
            for hit in hits:
                if hit.source_type is SearchSourceType.DOCUMENT_CHUNK:
                    try:
                        source = await self.chunk_source(uow, workspace_id, hit.source_id, version=hit.source_version)
                    except (GoneError, NotFoundError):
                        continue
                    hit.payload.update(relative_path=source["relative_path"], locator=source["locator"])
                visible.append(hit)
        return visible

    @staticmethod
    async def _agent_output_paths(uow: IUnitOfWork, workspace_id: str, root_id: str) -> set[str]:
        if hasattr(uow, "change") and hasattr(uow.change, "agent_output_paths"):
            return await uow.change.agent_output_paths(workspace_id, root_id)
        return set()

    @staticmethod
    def _normalize_paths(root_id: str, raw_paths: list[str], *, empty_message: str) -> list[str]:
        result: list[str] = []
        for item in sorted(set(raw_paths)):
            path = RootedPath(root_id=root_id, relative_path=item)
            if not path.relative_path:
                raise BadRequestError(empty_message)
            result.append(path.relative_path)
        return result

    async def update_policy(
            self, workspace_id: str, *, version: int, paused: bool, excluded_directories: list[str],
            scope_confirmed: bool,
            excluded_files: list[str] | None = None,
            included_files: list[str] | None = None,
            enabled_categories: list[DocumentCategory] | None = None,
            agent_outputs: AgentOutputPolicy | None = None,
    ) -> WorkspaceIndexSummary:
        retired_any = False
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            root = await uow.root.workspace_folder(workspace_id)
            if not workspace or workspace.status is not WorkspaceStatus.ACTIVE or not root:
                raise ConflictError("工作区当前不能更改索引范围")
            pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
            directories = self._normalize_paths(
                root.ref.root_id, excluded_directories, empty_message="请使用暂停开关停止整个工作区的索引")
            ex_files = self._normalize_paths(
                root.ref.root_id,
                pub.policy.excluded_files if excluded_files is None else excluded_files,
                empty_message="排除的文件路径不能为空",
            )
            in_files = self._normalize_paths(
                root.ref.root_id,
                pub.policy.included_files if included_files is None else included_files,
                empty_message="纳入的文件路径不能为空",
            )
            if set(ex_files) & set(in_files):
                raise BadRequestError("同一文件不能同时设置为排除和纳入")
            raw_categories = pub.policy.enabled_categories if enabled_categories is None else enabled_categories
            categories = [cat for cat in DocumentCategory if cat in set(raw_categories)]
            outputs = pub.policy.agent_outputs if agent_outputs is None else agent_outputs
            if pub.policy.version != version:
                current_tuple = (
                    pub.policy.paused, pub.policy.excluded_directories, pub.policy.excluded_files,
                    pub.policy.included_files, pub.policy.enabled_categories, pub.policy.agent_outputs,
                    pub.policy.scope_confirmed,
                )
                requested_tuple = (paused, directories, ex_files, in_files, categories, outputs, scope_confirmed)
                if current_tuple != requested_tuple:
                    raise ConflictError("索引设置已变化，请刷新后再修改", resource_version=pub.policy.version)
            else:
                before_generation = pub.generation
                pub.policy = IndexPolicy(
                    version=version + 1, paused=paused, excluded_directories=directories,
                    excluded_files=ex_files, included_files=in_files,
                    enabled_categories=categories, agent_outputs=outputs,
                    scope_confirmed=scope_confirmed,
                )
                if scope_confirmed:
                    pub.scope_review_required = False
                agent_output_set = await self._agent_output_paths(uow, workspace_id, root.ref.root_id)
                to_exclude = [
                    doc for doc in await uow.document.list_workspace(workspace_id)
                    if doc.status is not Status.WITHDRAWN and not policy_decision(
                        pub.policy, doc.relative_path, doc.format,
                        category=category_of(doc.format), is_agent_output=doc.relative_path in agent_output_set,
                    )[0]
                ]
                await _retire_many(uow, workspace_id, to_exclude, pub, Status.EXCLUDED)
                retired_any = pub.generation > before_generation
                pub.updated_at = utc_now()
                await uow.document.save_publication(pub)
        if retired_any:
            await self._enqueue_semantic(workspace_id)
        self._notify_scan(workspace_id)
        return await self.summary(workspace_id)

    def _notify_scan(self, workspace_id: str, paths: list[str] | None = None) -> None:
        from app.application.services.document_index_scheduler import get_document_index_scheduler
        try:
            get_document_index_scheduler().notify(workspace_id, paths)
        except RuntimeError:
            pass
        self.wake()

    async def start_scan(
            self, workspace_id: str, *, paths: list[str] | None = None,
            retry: bool = False, document_id: str | None = None, revision: int | None = None,
    ) -> BackgroundJob:
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            root = await uow.root.workspace_folder(workspace_id)
            if not workspace or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            if workspace.status is not WorkspaceStatus.ACTIVE or not root or root.status is not FolderStatus.AVAILABLE:
                raise ConflictError("工作区文件夹当前不可索引")
            pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
            if retry and (pub.policy.paused or pub.scope_review_required):
                raise ConflictError("请先恢复索引并确认范围")
            if document_id is not None:
                doc = await uow.document.get(document_id)
                if not doc or doc.workspace_id != workspace_id:
                    raise NotFoundError("没有找到该文档")
                if doc.status is not Status.FAILED or doc.current_revision != revision:
                    raise ConflictError("文档的索引状态已变化，请刷新后重试")
                paths = [doc.relative_path]
            payload = dict(workspace_id=workspace_id, scan=True, paths=paths, retry=retry,
                           document_id=document_id, revision=revision, binding=list(_binding(root)))
            if pub.scan_operation_id:
                previous = await uow.job.get(pub.scan_operation_id)
                if previous and not previous.status.terminal:
                    if previous.payload == payload:
                        return previous
                    raise ConflictError("已有扫描或重试任务进行中")
            operation_id = str(uuid.uuid4())
            job = await uow.job.add(BackgroundJob(
                operation_id=operation_id, kind=OperationKind.DOCUMENT_INDEX, retry_supported=True,
                scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
                payload=payload, idempotency_key=f"document_scan:{workspace_id}:{operation_id}",
                progress=OperationProgress(completed=0, total=None),
            ))
            pub.scan_operation_id = job.operation_id
            pub.last_error = None
            await uow.document.save_publication(pub)
        self.wake()
        return job

    async def _process_scan(self, context: JobContext) -> dict:
        arguments = context.job.payload
        workspace_id = arguments["workspace_id"]
        error_message = None
        async with self._uow_factory() as uow:
            await context.check_cancel_in(uow)
            pub = await uow.document.get_publication(workspace_id)
            if not pub or pub.scan_operation_id not in (None, context.job.operation_id):
                return {"status": "skipped", "reason": "scan_superseded"}
            pub.scan_operation_id = context.job.operation_id
            await uow.document.save_publication(pub)

        try:
            await context.progress(phase="扫描文件夹", completed=0)
            paths = arguments.get("paths")
            async with self._scan_lock:
                return await self._sync(workspace_id, set(paths) if paths is not None else None,
                                        arguments["retry"], scan_context=context)
        except JobCancelled:
            raise
        except Exception as error:
            error_message = str(error)
            raise
        finally:
            async with self._uow_factory() as uow:
                try:
                    await context.check_cancel_in(uow)
                except JobCancelled:
                    pass
                pub = await uow.document.get_publication(workspace_id)
                if pub and pub.scan_operation_id == context.job.operation_id:
                    pub.scan_operation_id = None
                    if error_message:
                        pub.last_error = error_message
                    await uow.document.save_publication(pub)

    async def sync_workspace(
            self, workspace_id: str, *, paths: set[str] | None = None, retry: bool = False,
    ) -> dict:
        # 重扫和通知共用登记入口，避免较旧快照覆盖同时提交的较新快照。
        async with self._scan_lock:
            return await self._sync(workspace_id, paths, retry)

    async def _sync(
            self, workspace_id: str, paths: set[str] | None, retry: bool, *, scan_context: JobContext | None = None,
    ) -> dict:
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            root = await uow.root.workspace_folder(workspace_id)
            publication = await uow.document.get_publication(workspace_id)
            agent_output_set = (
                await self._agent_output_paths(uow, workspace_id, root.ref.root_id)
                if workspace is not None and root is not None else set()
            )
        if workspace is None or workspace.status is not WorkspaceStatus.ACTIVE or root is None:
            return {"status": "skipped", "reason": "workspace_unavailable"}
        if root.status is not FolderStatus.AVAILABLE:
            if scan_context is not None:
                raise ConflictError("工作区文件夹当前不可索引")
            return {"status": "skipped", "reason": "folder_unavailable"}
        if scan_context and scan_context.job.payload["binding"] != list(_binding(root)):
            return {"status": "skipped", "reason": "folder_changed"}
        policy = publication.policy if publication else IndexPolicy()
        files_at_root = self._bound_files(root)
        root_path = RootedPath(root_id=root.ref.root_id)
        effective_excluded_dirs = frozenset(
            directory for directory in policy.excluded_directories
            if not any(path == directory or path.startswith(directory + "/") for path in policy.included_files)
        )
        try:
            if effective_excluded_dirs:
                snapshot = await self._files.snapshot(root_path, exclude=effective_excluded_dirs)
            else:
                snapshot = await self._files.snapshot(root_path)
        except WorkspaceFileError as error:
            if error.code is ErrorCode.UNAVAILABLE and scan_context is None:
                async with self._uow_factory() as uow:
                    current_root = await uow.root.workspace_folder(workspace_id)
                    if _binding(current_root) == _binding(root):
                        await uow.root.set_folder_state(root.ref.root_id, FolderStatus.UNAVAILABLE, utc_now())
                        pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
                        pub.last_error = str(error)
                        pub.status = "failed"
                        pub.updated_at = utc_now()
                        await uow.document.save_publication(pub)
                logger.warning("工作区文件夹不可用，跳过后台文档同步 workspace=%s: %s", workspace_id, error)
                return {"status": "skipped", "reason": "folder_unavailable"}
            async with self._uow_factory() as uow:
                pub = await self._scan_publication(uow, workspace_id, root, policy, scan_context)
                pub.last_error = str(error)
                pub.status = "failed"
                await uow.document.save_publication(pub)
            raise app_error(error) from error

        files: dict[str, tuple[int, int]] = {}
        pending_outputs: list[str] = []
        category_skipped = 0
        for path, values in snapshot.files.items():
            fmt = detect_format(path)
            allowed, reason = policy_decision(
                policy, path, fmt, category=category_of(fmt), is_agent_output=path in agent_output_set,
            )
            if allowed:
                files[path] = values
            elif reason == "agent_output":
                pending_outputs.append(path)
            elif reason == "category_disabled":
                category_skipped += 1
        pending_outputs.sort()
        directories = {path.rsplit("/", 1)[0] for path in files if "/" in path}
        directories.update(path.split("/", 1)[0] for path in directories.copy())
        directory_sizes: dict[str, IndexDirectorySize] = {}
        for path, (size, _) in files.items():
            directory = path.rpartition("/")[0]
            counts = directory_sizes.setdefault(directory, IndexDirectorySize())
            counts.files += 1
            counts.bytes += size
        review_required = not policy.scope_confirmed and (
            snapshot.truncated or len(files) >= DOCUMENT_SCOPE_REVIEW_FILES
            or sum(size for size, _ in files.values()) >= DOCUMENT_SCOPE_REVIEW_BYTES
        )
        # 在写锁外先确认缺席文件是否真的从磁盘删除，避免持锁期间做磁盘 stat。
        async with self._read_uow_factory() as uow:
            existing_before = await uow.document.list_workspace(workspace_id)
        effective_paths = (
            {doc.relative_path for doc in existing_before if doc.status is Status.FAILED}
            if retry and paths is None else paths
        )
        confirmed_missing: set[str] = set()
        for doc in existing_before:
            if doc.status is Status.WITHDRAWN:
                continue
            allowed, _ = policy_decision(
                policy, doc.relative_path, doc.format,
                category=category_of(doc.format), is_agent_output=doc.relative_path in agent_output_set,
            )
            if (allowed and (not snapshot.truncated or effective_paths is not None)
                    and doc.relative_path not in snapshot.files
                    and self._selected(doc.relative_path, effective_paths)):
                if await self._confirmed_missing(files_at_root, RootedPath(root_id=root.ref.root_id, relative_path=doc.relative_path)):
                    confirmed_missing.add(doc.relative_path)

        async with self._uow_factory() as uow:
            pub = await self._scan_publication(uow, workspace_id, root, policy, scan_context)
            existing = {doc.relative_path: doc for doc in await uow.document.list_workspace(workspace_id)}
            revisions = await uow.document.current_revisions(workspace_id)
            if retry and paths is None:
                paths = {doc.relative_path for doc in existing.values() if doc.status is Status.FAILED}
            excluded_directory_sizes: dict[str, IndexDirectorySize] = {}
            excluded_files = excluded_bytes = 0
            to_exclude: list[DocumentRecord] = []
            to_withdraw: list[DocumentRecord] = []
            for path, doc in existing.items():
                if doc.status is Status.WITHDRAWN:
                    continue
                allowed, _ = policy_decision(
                    policy, path, doc.format, category=category_of(doc.format), is_agent_output=path in agent_output_set,
                )
                if not allowed:
                    to_exclude.append(doc)
                    revision = revisions.get(doc.id)
                    if revision is None:
                        continue
                    excluded_files += 1
                    excluded_bytes += revision.size
                    if path not in policy.included_files and excluded_directory(policy, path):
                        for directory in policy.excluded_directories:
                            if path == directory or path.startswith(directory + "/"):
                                counts = excluded_directory_sizes.setdefault(directory, IndexDirectorySize())
                                counts.files += 1
                                counts.bytes += revision.size
                elif ((not snapshot.truncated or paths is not None)
                      and path not in snapshot.files
                      and self._selected(path, paths)
                      and path in confirmed_missing):
                    to_withdraw.append(doc)
            pub.scan = IndexScope(files=len(files), bytes=sum(size for size, _ in files.values()),
                                  directories=sorted(directories), truncated=snapshot.truncated,
                                  directory_sizes=directory_sizes, excluded_directory_sizes=excluded_directory_sizes,
                                  excluded_files=excluded_files, excluded_bytes=excluded_bytes,
                                  pending_outputs=pending_outputs, category_skipped=category_skipped)
            pub.scope_review_required = review_required
            if pub.status == "failed" and not pub.active_operation_id:
                pub.status = "idle"
                pub.last_error = None
            await _retire_many(uow, workspace_id, to_exclude, pub, Status.EXCLUDED)
            withdrawn = await _retire_many(uow, workspace_id, to_withdraw, pub, Status.WITHDRAWN)
            await uow.document.save_publication(pub)

        registered = queued = 0
        if policy.paused or review_required:
            return {"status": "ok", "registered": 0, "withdrawn": withdrawn, "pending_parse": 0,
                    "truncated": snapshot.truncated, "operation_id": None}
        for index, (path, (size, modified_ns)) in enumerate(files.items()):
            if scan_context and index % 200 == 0:
                await scan_context.check_cancel()
                await scan_context.progress(phase="登记文件", completed=index, total=len(files))
            if not self._selected(path, paths):
                continue
            doc = existing.get(path)
            if doc is not None:
                current = revisions.get(doc.id)
                if (current and doc.status not in RETIRED and current.status is not Status.REGISTERED
                        and (size, modified_ns) == (current.size, current.modified_ns)
                        and (current.parse_config, current.chunk_config) == (PARSE_CONFIG_FINGERPRINT, CHUNK_CONFIG_FINGERPRINT)
                        and not (retry and (current.status is Status.FAILED or current.ocr_state is DocumentOcrState.FAILED))):
                    continue
            fmt = detect_format(path)
            reason = component = None
            status = Status.PENDING_PARSE
            if size > DOCUMENT_PARSE_MAX_BYTES:
                content_hash, status, reason = "oversized", Status.FAILED, "文件超过解析大小上限"
            else:
                rooted = RootedPath(root_id=root.ref.root_id, relative_path=path)
                try:
                    entry = await files_at_root.stat(rooted, with_hash=True)
                except WorkspaceFileError as error:
                    if error.code in (ErrorCode.NOT_FOUND, ErrorCode.UNAVAILABLE):
                        continue
                    content_hash, status, reason = "unreadable", Status.FAILED, str(error)
                else:
                    if not entry.version or not entry.version.content_hash:
                        continue
                    size, modified_ns = entry.version.size, entry.version.modified_ns
                    content_hash = entry.version.content_hash
                    if fmt is DocumentFormat.IMAGE and not (self._ocr_dir_probe and self._ocr_dir_probe()):
                        status, component = Status.PENDING_COMPONENT, "ocr"
            async with self._uow_factory() as uow:
                pub = await self._scan_publication(uow, workspace_id, root, policy, scan_context)
                doc = await uow.document.get_by_path(workspace_id, path)
                if retry and scan_context and scan_context.job.payload["document_id"] is not None and (
                        doc is None or doc.id != scan_context.job.payload["document_id"]
                        or doc.current_revision != scan_context.job.payload["revision"]):
                    continue
                if doc is None:
                    doc = DocumentRecord(id=str(uuid.uuid4()), workspace_id=workspace_id, relative_path=path, format=fmt)
                    registered += 1
                    await uow.document.save(doc)
                current = await uow.document.get_revision_by_number(doc.id, doc.current_revision)
                if (current and doc.status not in (*RETIRED, Status.REGISTERED) and current.content_hash == content_hash
                        and (current.parse_config, current.chunk_config) == (PARSE_CONFIG_FINGERPRINT, CHUNK_CONFIG_FINGERPRINT)
                        and not (retry and current.status is Status.FAILED)):
                    current.size, current.modified_ns = size, modified_ns
                    if retry and current.status is Status.SEARCHABLE and current.ocr_state is DocumentOcrState.FAILED:
                        current.ocr_state, current.ocr_error = DocumentOcrState.PENDING, None
                    await uow.document.save_revision(current)
                    continue
                await _unpublish(uow, doc, pub)
                rev = DocumentRevision(
                    id=str(uuid.uuid4()), document_id=doc.id, workspace_id=workspace_id,
                    revision=doc.current_revision + 1, source_epoch=doc.source_epoch, relative_path=path,
                    content_hash=content_hash, size=size, modified_ns=modified_ns, status=status, format=fmt,
                    error_message=reason, component_needed=component,
                    ocr_state=DocumentOcrState.WAITING_COMPONENT if component == "ocr" else None,
                )
                await uow.document.add_revision(rev)
                doc.current_revision, doc.status, doc.format = rev.revision, status, fmt
                doc.updated_at = utc_now()
                await uow.document.save(doc)
                await uow.document.save_publication(pub)
                queued += int(status is Status.PENDING_PARSE)
        async with self._uow_factory() as uow:
            await self._scan_publication(uow, workspace_id, root, policy, scan_context)
            job = await self._ensure_job(uow, workspace_id)
        if job:
            self.wake()
        elif queued == 0:
            await self._enqueue_semantic(workspace_id)
        return {"status": "ok", "registered": registered, "withdrawn": withdrawn, "pending_parse": queued,
                "truncated": snapshot.truncated, "operation_id": job.operation_id if job else None}

    async def _scan_publication(
            self, uow: IUnitOfWork, workspace_id: str, root: RootRecord, policy: IndexPolicy,
            scan_context: JobContext | None,
    ) -> IndexPublication:
        ws = await uow.workspace.get(workspace_id)
        pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
        if scan_context:
            await scan_context.check_cancel_in(uow)
            if pub.scan_operation_id != scan_context.job.operation_id:
                raise ConflictError("扫描已失效，请重新扫描")
        if (ws is None or ws.status is not WorkspaceStatus.ACTIVE or pub.policy.version != policy.version
                or _binding(await uow.root.workspace_folder(workspace_id)) != _binding(root)):
            raise ConflictError("索引范围或文件夹已改变，请重新扫描")
        return pub

    @staticmethod
    def _selected(path: str, paths: set[str] | None) -> bool:
        return paths is None or any(not p or path == p or path.startswith(p.rstrip("/") + "/") for p in paths)

    async def _confirmed_missing(self, files, path: RootedPath) -> bool:
        try:
            return (await files.stat(path)).kind is not FileKind.FILE
        except WorkspaceFileError as error:
            return error.code is ErrorCode.NOT_FOUND

    async def _ensure_job(self, uow: IUnitOfWork, workspace_id: str) -> BackgroundJob | None:
        pub = await uow.document.get_publication(workspace_id) or IndexPublication(workspace_id=workspace_id)
        workspace = await uow.workspace.get(workspace_id)
        root = await uow.root.workspace_folder(workspace_id)
        if (not workspace or workspace.status is not WorkspaceStatus.ACTIVE or not root
                or root.status is not FolderStatus.AVAILABLE or pub.policy.paused or pub.scope_review_required):
            return None
        pending = await uow.document.list_revisions_by_status(workspace_id, PENDING, limit=1)
        if not pending and not await uow.document.next_ocr_revision(workspace_id, available=self._ocr_path() is not None):
            return None
        if pub.active_operation_id:
            existing = await uow.job.get(pub.active_operation_id)
            if existing and not existing.status.terminal:
                return existing
        operation_id = str(uuid.uuid4())
        job = await uow.job.add(BackgroundJob(
            operation_id=operation_id, kind=OperationKind.DOCUMENT_INDEX, retry_supported=True,
            scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
            payload={"workspace_id": workspace_id}, idempotency_key=f"document_index:{workspace_id}:{operation_id}",
            progress=OperationProgress(completed=0, total=None),
        ))
        pub.status, pub.active_operation_id, pub.last_error = "publishing", job.operation_id, None
        pub.updated_at = utc_now()
        await uow.document.save_publication(pub)
        return job

    def _ocr_path(self) -> Path | None:
        return self._ocr_dir_probe() if self._ocr_dir_probe else None

    async def reconcile_ocr(self) -> None:
        async with self._read_uow_factory() as uow:
            workspaces = await uow.document.list_publication_workspace_ids()
        for workspace_id in workspaces:
            async with self._uow_factory() as uow:
                job = await self._ensure_job(uow, workspace_id)
            if job:
                self.wake()

    async def _guard(self, context: JobContext, uow: IUnitOfWork, workspace_id: str):
        await context.check_cancel_in(uow)
        pub = await uow.document.get_publication(workspace_id)
        root = await uow.root.workspace_folder(workspace_id)
        ws = await uow.workspace.get(workspace_id)
        if not ws or not pub or (pub.active_operation_id and pub.active_operation_id != context.job.operation_id):
            raise _IndexStopped()
        if (not root or root.status is not FolderStatus.AVAILABLE or ws.status is not WorkspaceStatus.ACTIVE
                or pub.policy.paused or pub.scope_review_required):
            raise _IndexStopped()
        return pub, root

    async def _close_job(self, context: JobContext, workspace_id: str, *, error: str | None = None) -> None:
        async with self._uow_factory() as uow:
            try:
                await context.check_cancel_in(uow)
            except JobCancelled:
                pass  # 当前所有者仍可清理自己的指针。
            pub = await uow.document.get_publication(workspace_id)
            if pub and pub.active_operation_id == context.job.operation_id:
                pub.status, pub.active_operation_id, pub.last_error = ("failed" if error else "idle"), None, error
                pub.updated_at = utc_now()
                await uow.document.save_publication(pub)

    async def _current(self, uow: IUnitOfWork, rev: DocumentRevision, expected: Status):
        doc = await uow.document.get(rev.document_id)
        current = await uow.document.get_revision(rev.id)
        if (doc and current and doc.current_revision == rev.revision
                and doc.source_epoch == rev.source_epoch and current.status is expected):
            return doc, current
        return None

    async def _state(
            self, uow: IUnitOfWork, doc: DocumentRecord, rev: DocumentRevision, status: Status,
            *, message: str | None = None, component: str | None = None,
    ) -> None:
        doc.status = rev.status = status
        doc.updated_at = rev.updated_at = utc_now()
        rev.error_message, rev.component_needed = message, component
        await uow.document.save_revision(rev)
        await uow.document.save(doc)

    async def process_workspace(self, context: JobContext) -> dict:
        if context.job.payload.get("scan"):
            return await self._process_scan(context)
        workspace_id = context.job.payload["workspace_id"]
        processed = failed = skipped = 0
        try:
            while True:
                async with self._uow_factory() as uow:
                    pub, root = await self._guard(context, uow, workspace_id)
                    if pub.active_operation_id is None:
                        # 通用重试可以领取旧操作。它只在没有新所有者时接管发布指针。
                        pub.active_operation_id = context.job.operation_id
                        pub.status, pub.last_error = "publishing", None
                        await uow.document.save_publication(pub)
                    batch = await uow.document.list_revisions_by_status(workspace_id, PENDING, limit=1)
                    rev = batch[0] if batch else await uow.document.next_ocr_revision(
                        workspace_id, available=self._ocr_path() is not None)
                    if not rev:
                        pub.active_operation_id, pub.status = None, "idle"
                        await uow.document.save_publication(pub)
                        break
                    doc = await uow.document.get(rev.document_id)
                    supplemental = rev.status is Status.SEARCHABLE
                    if supplemental:
                        rev.ocr_state = DocumentOcrState.RUNNING
                        await uow.document.save_revision(rev)
                    else:
                        if rev.status in IN_PROGRESS:
                            await uow.document.replace_chunks(rev.id, [])
                            await uow.document.replace_blocks(rev.id, [])
                        if rev.ocr_state is DocumentOcrState.WAITING_COMPONENT:
                            rev.ocr_state = DocumentOcrState.RUNNING
                        await self._state(uow, doc, rev, Status.PARSING)
                phase = "补录文字" if supplemental else "解析"
                await context.progress(phase=f"{phase} {rev.relative_path}", completed=processed + failed + skipped)
                try:
                    outcome = await self._parse_and_publish(context, root, rev, supplemental=supplemental)
                except _IndexStopped:
                    async with self._read_uow_factory() as uow:
                        await self._guard(context, uow, workspace_id)
                    outcome = "skipped"
                processed += int(outcome == "ok")
                failed += int(outcome == "failed")
                skipped += int(outcome == "skipped")
        except _IndexStopped:
            await self._close_job(context, workspace_id)
        except JobCancelled:
            await self._close_job(context, workspace_id)
            raise
        except JobSuperseded:
            raise
        except Exception as error:
            await self._close_job(context, workspace_id, error=str(error))
            raise
        await self._enqueue_semantic(workspace_id)
        return {"processed": processed, "failed": failed, "skipped": skipped}

    async def _parse_and_publish(
            self, context: JobContext, root: RootRecord, rev: DocumentRevision, *, supplemental: bool,
    ) -> str:
        cancel = asyncio.Event()
        interruption: Exception | None = None
        expected = Status.SEARCHABLE if supplemental else Status.PARSING
        covered_pages = None
        if supplemental:
            async with self._read_uow_factory() as uow:
                prior_blocks = await uow.document.list_blocks(rev.id)
            covered_pages = {block.locator["page"] for block in prior_blocks if type(block.locator.get("page")) is int}

        async def watch_cancel() -> None:
            nonlocal interruption
            while not cancel.is_set():
                try:
                    async with self._read_uow_factory() as uow:
                        await self._guard(context, uow, rev.workspace_id)
                        if not await self._current(uow, rev, expected):
                            raise _IndexStopped()
                except (JobCancelled, JobSuperseded, _IndexStopped) as error:
                    interruption = error
                    cancel.set()
                    return
                await asyncio.sleep(0.4)

        watcher = asyncio.create_task(watch_cancel())
        path = RootedPath(root_id=root.ref.root_id, relative_path=rev.relative_path)
        files = self._bound_files(root)
        changed = False
        try:
            with tempfile.TemporaryDirectory(prefix="rayagent-doc-src-") as tmp:
                src = Path(tmp) / Path(rev.relative_path).name
                reader = await files.open_reader(path)

                def copy() -> str:
                    digest = hashlib.sha256()
                    size = 0
                    with reader, src.open("wb") as out:
                        while data := reader.read(1024 * 1024):
                            size += len(data)
                            if size > DOCUMENT_PARSE_MAX_BYTES:
                                raise ValueError("文件超过解析大小上限")
                            if cancel.is_set():
                                break
                            digest.update(data)
                            out.write(data)
                    return digest.hexdigest()

                copying = asyncio.create_task(asyncio.to_thread(copy))
                try:
                    digest = await asyncio.shield(copying)
                except asyncio.CancelledError:
                    cancel.set()
                    await asyncio.gather(copying, return_exceptions=True)
                    raise
                if interruption:
                    raise interruption
                changed = digest != rev.content_hash
                if not changed:
                    try:
                        result = await run_document_parse(src, rev.format.value, cancel_event=cancel,
                                                          ocr_component_dir=self._ocr_path(), covered_pages=covered_pages)
                    except asyncio.CancelledError:
                        if interruption:
                            raise interruption
                        raise
                    if interruption:
                        raise interruption
                    actual = (await files.stat(path, with_hash=True)).version
                    changed = (actual is None or (actual.size, actual.modified_ns) != (rev.size, rev.modified_ns)
                               or actual.content_hash != rev.content_hash)
        except (JobCancelled, JobSuperseded, _IndexStopped):
            raise
        except Exception as error:
            result = {"status": "failed", "reason": str(error) or type(error).__name__}
        finally:
            cancel.set()
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

        if changed:
            async with self._uow_factory() as uow:
                _, current_root = await self._guard(context, uow, rev.workspace_id)
                if _binding(current_root) == _binding(root) and (pair := await self._current(uow, rev, expected)):
                    await self._state(uow, *pair, Status.REGISTERED, message="源文件已变化，等待重新扫描")
            self._notify_scan(rev.workspace_id, [rev.relative_path])
            return "skipped"

        if supplemental:
            return await self._publish_supplement(context, root, rev, result)

        status = result.get("status")
        if status != "ok":
            async with self._uow_factory() as uow:
                _, current_root = await self._guard(context, uow, rev.workspace_id)
                if _binding(current_root) != _binding(root) or not (pair := await self._current(uow, rev, Status.PARSING)):
                    return "skipped"
                pending = status == "pending_component"
                self._save_ocr_result(pair[1], result)
                await self._state(uow, *pair, Status.PENDING_COMPONENT if pending else Status.FAILED,
                                  message=(result.get("reason") or "解析失败")[:1000],
                                  component=(result.get("component_needed") or "ocr") if pending else None)
            return "skipped" if pending else "failed"

        blocks = blocks_from_worker(result, revision_id=rev.id, workspace_id=rev.workspace_id)
        chunks = chunk_blocks(blocks, document_id=rev.document_id, revision_id=rev.id,
                              workspace_id=rev.workspace_id, revision=rev.revision, title=Path(rev.relative_path).name)
        if not chunks:
            async with self._uow_factory() as uow:
                await self._guard(context, uow, rev.workspace_id)
                if pair := await self._current(uow, rev, Status.PARSING):
                    await self._state(uow, *pair, Status.FAILED, message="没有可检索的正文")
            return "failed"
        async with self._uow_factory() as uow:
            _, current_root = await self._guard(context, uow, rev.workspace_id)
            if _binding(current_root) != _binding(root) or not (pair := await self._current(uow, rev, Status.PARSING)):
                return "skipped"
            await self._state(uow, *pair, Status.INDEXING)
            await uow.document.replace_blocks(rev.id, blocks)
            await uow.document.replace_chunks(rev.id, chunks)

        async with self._uow_factory() as uow:
            pub, current_root = await self._guard(context, uow, rev.workspace_id)
            if _binding(current_root) != _binding(root) or not (pair := await self._current(uow, rev, Status.INDEXING)):
                return "skipped"
            doc, current = pair
            try:
                actual = (await files.stat(path)).version
            except WorkspaceFileError as error:
                if error.code is ErrorCode.NOT_FOUND:
                    await _retire(uow, doc, pub, Status.WITHDRAWN)
                    await uow.document.save_publication(pub)
                else:
                    await self._state(uow, doc, current, Status.FAILED, message=str(error))
                return "skipped"
            if actual is None or (actual.size, actual.modified_ns) != (rev.size, rev.modified_ns):
                await self._state(uow, doc, current, Status.REGISTERED, message="源文件已变化，等待重新扫描")
                self._notify_scan(rev.workspace_id, [rev.relative_path])
                return "skipped"
            await _unpublish(uow, doc, pub)
            for chunk in chunks:
                await self._retrieval.index_document_chunk(uow, chunk, relative_path=doc.relative_path)
            await uow.document.mark_chunks_published(rev.id, True)
            current.published_at = utc_now()
            self._save_ocr_result(current, result)
            await self._state(uow, doc, current, Status.SEARCHABLE)
            pub.generation += 1
            pub.updated_at = utc_now()
            await uow.document.save_publication(pub)
        await self._enqueue_semantic(rev.workspace_id)
        return "ok"

    @staticmethod
    def _save_ocr_result(rev: DocumentRevision, result: dict) -> None:
        if type(result.get("page_count")) is int and result["page_count"] > 0:
            rev.page_count = result["page_count"]
        state = result.get("ocr_state")
        if state is None and rev.ocr_state is DocumentOcrState.RUNNING:
            state = DocumentOcrState.FAILED
        if state is not None:
            rev.ocr_state = DocumentOcrState(state)
            rev.ocr_pages_pending = result.get("ocr_pages_pending")
            rev.ocr_error = (result.get("reason") or "文字识别失败")[:1000] if rev.ocr_state is DocumentOcrState.FAILED else None

    async def _publish_supplement(
            self, context: JobContext, root: RootRecord, rev: DocumentRevision, result: dict,
    ) -> str:
        async with self._uow_factory() as uow:
            pub, current_root = await self._guard(context, uow, rev.workspace_id)
            pair = await self._current(uow, rev, Status.SEARCHABLE)
            if _binding(current_root) != _binding(root) or not pair:
                return "skipped"
            doc, current = pair
            path = RootedPath(root_id=root.ref.root_id, relative_path=rev.relative_path)
            try:
                actual = (await self._bound_files(root).stat(path)).version
            except WorkspaceFileError:
                actual = None
            if actual is None or (actual.size, actual.modified_ns) != (rev.size, rev.modified_ns):
                await self._state(uow, doc, current, Status.REGISTERED, message="源文件已变化，等待重新扫描")
                self._notify_scan(rev.workspace_id, [rev.relative_path])
                return "skipped"
            self._save_ocr_result(current, result)
            current.updated_at = utc_now()
            await uow.document.save_revision(current)
            if result.get("status") != "ok":
                return "failed"
            blocks = blocks_from_worker(result, revision_id=rev.id, workspace_id=rev.workspace_id)
            if not blocks:
                return "ok"
            prior_blocks = await uow.document.list_blocks(rev.id)
            block_offset = max((block.ordinal for block in prior_blocks), default=-1) + 1
            for block in blocks:
                block.ordinal += block_offset
            chunks = chunk_blocks(blocks, document_id=rev.document_id, revision_id=rev.id,
                                  workspace_id=rev.workspace_id, revision=rev.revision, title=Path(rev.relative_path).name)
            prior_chunks = await uow.document.list_chunks(rev.id)
            chunk_offset = max((chunk.ordinal for chunk in prior_chunks), default=-1) + 1
            for chunk in chunks:
                chunk.ordinal += chunk_offset
                chunk.published = True
                await self._retrieval.index_document_chunk(uow, chunk, relative_path=doc.relative_path)
            await uow.document.add_blocks(blocks)
            await uow.document.add_chunks(chunks)
            pub.generation += 1
            pub.updated_at = utc_now()
            await uow.document.save_publication(pub)
        await self._enqueue_semantic(rev.workspace_id)
        return "ok"

    async def _enqueue_semantic(self, workspace_id: str) -> None:
        if self._semantic is not None:
            try:
                await self._semantic.enqueue(workspace_id)
            except Exception:
                logger.exception("排队语义索引失败 workspace=%s", workspace_id)


def document_index_handler(service: DocumentIndexService):
    return service.process_workspace
