"""工作区文件夹里一次运行的文件变更：列出、预览撤销结果、撤销本次修改。

变更记录按写入顺序保存；同一运行对同一文件的多行折叠成「运行前版本」（第一行的写前对象）与「运行最后写入版本」
（最后一行的写后版本）。撤销把文件恢复为运行前版本，并且只在当前版本仍是运行最后写入的版本时自动进行：
之后被外部改动过的文件返回冲突，由用户在看到当前版本后明确要求「仍要恢复」才覆盖。运行新建的文件只有仍等于
运行写入的内容时才会被移除，被改动过就不删除。恢复与移除都经同一个写入口，所以会先保存撤销前备份、占用写入租约，
并作为 source=undo 的变更记录下来；撤销不回滚会话事件与记忆。
"""
import asyncio
import difflib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Literal, Optional

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.domain.external.workspace_files import FileEntry, FileKind, FileVersion, WorkspaceFileError, WorkspaceFiles
from app.domain.external.workspace_objects import WorkspaceObjects
from app.domain.models.error import ErrorCode
from app.domain.models.file_change import ChangeOperation, FileChange, WorkspaceObject
from app.domain.models.identity import RootedPath
from app.domain.models.workspace import RootRecord, WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_io import run_async_io
from app.domain.services.file_scope import WriteOwner
from app.domain.services.file_streams import VerifyingReader
from app.application.services.workspace_writer import WorkspaceWriter
from app.application.services.write_leases import WriteLeaseService

logger = logging.getLogger(__name__)

EntryStatus = Literal["undoable", "restored", "conflict"]
ConflictReason = Literal["modified", "missing", "appeared", "not_file", "modified_during_run"]
GAP_WARNING = "运行期间这个文件被外部修改过：撤销会同时丢掉那些修改（撤销前会先备份当前版本，之后仍可撤回）"
UndoStatus = Literal["restored", "removed", "unchanged", "conflict", "failed"]


@dataclass
class Version:
    size: int
    modified_ns: Optional[int] = None
    sha256: Optional[str] = None


@dataclass
class ChangeEntry:
    root_id: str
    relative_path: str
    operation: ChangeOperation  # 折叠后的净操作：运行前不存在为 create，运行前存在且最后被删除为 delete，其余为 modify
    writes: int
    first_at: datetime
    last_at: datetime
    before: Optional[Version]  # 运行前版本；create 为空
    after: Optional[Version]  # 运行最后写入版本；delete 为空
    current: Optional[Version]  # 文件夹里当前的版本；不存在为空
    status: EntryStatus
    conflict_reason: Optional[ConflictReason] = None
    can_force: bool = False  # 冲突时是否允许在看到当前版本后仍要恢复；运行新建的文件与非普通文件不允许
    preview_kind: Literal["restore", "remove"] = "restore"


@dataclass
class RunChangeList:
    run_id: str
    session_id: str
    session_title: str
    run_active: bool  # 运行仍在进行：不能撤销
    entries: list[ChangeEntry]
    kind: Literal["run", "undo"] = "run"  # undo：这次「运行」是一次撤销操作，撤回它即恢复撤销前的版本
    undo_of_run_id: Optional[str] = None


@dataclass
class RunSummary:
    run_id: str
    session_id: str
    session_title: str
    run_status: str
    changed_files: int
    first_at: datetime
    last_at: datetime
    kind: Literal["run", "undo"] = "run"
    undo_of_run_id: Optional[str] = None


@dataclass
class ChangePreview:
    kind: Literal["diff", "binary", "too_large", "unchanged"]
    diff: str = ""
    truncated: bool = False
    current_size: Optional[int] = None
    restore_size: Optional[int] = None
    removes_file: bool = False
    warning: str = ""  # 撤销会丢掉运行期间的外部修改等需要用户知道的情况


@dataclass
class ForceCurrent:
    """用户看到的当前版本；与实际当前版本不一致时不覆盖，重新返回冲突。"""
    exists: bool
    size: Optional[int] = None
    modified_ns: Optional[int] = None


@dataclass
class UndoItem:
    relative_path: str
    force: Optional[ForceCurrent] = None


@dataclass
class UndoOutcome:
    relative_path: str
    status: UndoStatus
    message: str = ""
    current: Optional[Version] = None
    conflict_reason: Optional[ConflictReason] = None
    can_force: bool = False


@dataclass
class _Folded:
    root_id: str
    path: str
    rows: list[FileChange]
    gap: bool = False  # 运行期间文件被外部改动过：相邻两次写入之间的实际版本与上一次写入的结果不一致

    @property
    def before_object_id(self) -> Optional[str]:
        first = self.rows[0]
        if first.operation is ChangeOperation.CREATE:
            if self.gap and self.rows[-1].operation is ChangeOperation.DELETE:
                return self.rows[-1].before_object_id  # 新建后被外部改写、又被运行删除：外部版本是最后一次删除前的备份
            return None
        return first.before_object_id

    @property
    def after(self):
        last = self.rows[-1]
        return None if last.operation is ChangeOperation.DELETE else last.after

    @property
    def operation(self) -> Optional[ChangeOperation]:
        before, after = self.before_object_id is not None, self.after is not None
        if not before and not after:
            return None  # 运行里新建后又删除，文件夹里没有净变化
        return ChangeOperation.CREATE if not before else ChangeOperation.DELETE if not after else ChangeOperation.MODIFY


def _has_gap(rows: list[FileChange], objects: dict[str, WorkspaceObject]) -> bool:
    """相邻两次写入之间文件是否被外部改动：下一次写入前实际看到的内容必须等于上一次写入的结果。
    无法比较（缺少哈希或备份已丢）时按没有处理。"""
    for previous, following in zip(rows, rows[1:]):
        was_absent = previous.operation is ChangeOperation.DELETE
        sees_absent = following.operation is ChangeOperation.CREATE
        if was_absent != sees_absent:
            return True
        if was_absent:
            continue
        backup = objects.get(following.before_object_id) if following.before_object_id else None
        written = previous.after.sha256 if previous.after is not None else None
        if backup is not None and written is not None and backup.sha256 != written:
            return True
    return False


def fold(rows: list[FileChange], objects: dict[str, WorkspaceObject]) -> list[_Folded]:
    grouped: dict[tuple[str, str], _Folded] = {}
    for row in rows:
        grouped.setdefault((row.root_id, row.relative_path), _Folded(row.root_id, row.relative_path, [])).rows.append(row)
    for item in grouped.values():
        item.gap = _has_gap(item.rows, objects)
    return [item for item in grouped.values() if item.operation is not None]


@dataclass
class _Judgement:
    status: EntryStatus
    current: Optional[Version]
    reason: Optional[ConflictReason] = None
    can_force: bool = False
    entry: Optional[FileEntry] = None


class FileHistoryService:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
                 files: WorkspaceFiles, writer: WorkspaceWriter, objects: WorkspaceObjects,
                 leases: WriteLeaseService, preview_bytes: int, preview_lines: int,
                 default_runs: int) -> None:
        self._uow_factory, self._read_uow_factory = uow_factory, read_uow_factory
        self._files, self._writer, self._objects, self._leases = files, writer, objects, leases
        self._preview_bytes, self._preview_lines, self._default_runs = preview_bytes, preview_lines, default_runs

    # ---- 读取 ----

    async def _folder(self, workspace_id: str) -> RootRecord:
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            root = await uow.root.workspace_folder(workspace_id) if workspace else None
        if workspace is None or workspace.status is WorkspaceStatus.DELETING:
            raise NotFoundError("工作区不存在")
        if root is None:
            raise BadRequestError("工作区没有绑定文件夹")
        return root

    async def recent_runs(self, workspace_id: str, limit: Optional[int] = None) -> list[RunSummary]:
        await self._folder(workspace_id)
        limit = limit or self._default_runs
        async with self._read_uow_factory() as uow:
            rows = await uow.change.runs(workspace_id, limit)
            summaries = []
            for row in rows:
                changes = await uow.change.for_run(workspace_id, row.run_id)
                backups = await uow.change.get_objects(
                    workspace_id, [change.before_object_id for change in changes if change.before_object_id])
                files = len(fold(changes, backups))
                if not files:
                    continue
                undo = row.undo_of_run_id is not None
                run = None if undo else await uow.run.get(row.run_id)
                session = await uow.session.get_by_id(row.session_id)
                summaries.append(RunSummary(
                    run_id=row.run_id, session_id=row.session_id,
                    session_title=session.title if session is not None else "",
                    run_status="completed" if undo else run.status.value if run is not None else "unknown",
                    changed_files=files, first_at=row.first_at, last_at=row.last_at,
                    kind="undo" if undo else "run", undo_of_run_id=row.undo_of_run_id))
        return summaries

    async def _run_changes(self, workspace_id: str, run_id: str) -> tuple[list[_Folded], str, bool, Optional[str]]:
        """折叠后的文件变更、所属会话、运行是否仍在进行，以及这条记录若是一次撤销，被撤销的运行。"""
        async with self._read_uow_factory() as uow:
            rows = await uow.change.for_run(workspace_id, run_id)
            if not rows:
                raise NotFoundError("这次运行在该工作区没有文件变更记录")
            active = await uow.run.get_active(rows[0].session_id)
            backups = await uow.change.get_objects(
                workspace_id, [row.before_object_id for row in rows if row.before_object_id])
        return (fold(rows, backups), rows[0].session_id, active is not None and active.id == run_id,
                rows[0].undo_of_run_id)

    async def _objects_of(self, workspace_id: str, folded: list[_Folded]) -> dict[str, WorkspaceObject]:
        """各文件运行前版本的备份对象。"""
        ids = [item.before_object_id for item in folded if item.before_object_id]
        async with self._read_uow_factory() as uow:
            return await uow.change.get_objects(workspace_id, ids)

    @staticmethod
    def _version(value) -> Optional[Version]:
        return Version(size=value.size, modified_ns=value.modified_ns, sha256=value.sha256) if value else None

    async def _judge(self, item: _Folded, before: Optional[WorkspaceObject]) -> _Judgement:
        """把文件夹里的当前版本与运行最后写入版本、运行前版本比较；只在大小一致而修改时间不同时才计算哈希。"""
        path = RootedPath(root_id=item.root_id, relative_path=item.path)
        after = item.after
        try:
            entry = await self._files.stat(path)
        except WorkspaceFileError as error:
            if error.code is not ErrorCode.NOT_FOUND:
                raise
            entry = None
        if entry is not None and entry.kind is not FileKind.FILE:
            return _Judgement("conflict", None, "not_file", False, entry)
        current = Version(entry.version.size, entry.version.modified_ns) if entry is not None else None
        if entry is not None and (
                (after is not None and entry.version.size == after.size and entry.version.modified_ns != after.modified_ns)
                or (before is not None and entry.version.size == before.size)):
            hashed = (await self._files.stat(path, with_hash=True)).version
            current = Version(hashed.size, hashed.modified_ns, hashed.content_hash)
        sha = current.sha256 if current is not None else None
        matches_last = (current is None) if after is None else (
            current is not None and ((current.modified_ns == after.modified_ns and current.size == after.size)
                                     or (sha is not None and sha == after.sha256)))
        restored = (current is None) if before is None else (
            current is not None and sha is not None and sha == before.sha256)
        if restored:
            return _Judgement("restored", current, entry=entry)
        if item.gap:
            # 即使当前版本仍是运行最后写入的，撤销也会丢掉运行期间的外部修改：不自动进行，看到当前版本后可仍要恢复
            return _Judgement("conflict", current, "modified_during_run", True, entry)
        if matches_last:
            return _Judgement("undoable", current, entry=entry)
        reason: ConflictReason = "missing" if current is None else "appeared" if after is None else "modified"
        return _Judgement("conflict", current, reason, before is not None, entry)

    async def changes(self, workspace_id: str, run_id: str) -> RunChangeList:
        await self._folder(workspace_id)
        folded, session_id, active, undo_of = await self._run_changes(workspace_id, run_id)
        objects = await self._objects_of(workspace_id, folded)
        entries = []
        try:
            for item in folded:
                before = objects.get(item.before_object_id) if item.before_object_id else None
                judgement = await self._judge(item, before)
                entries.append(ChangeEntry(
                    root_id=item.root_id, relative_path=item.path, operation=item.operation, writes=len(item.rows),
                    first_at=item.rows[0].created_at, last_at=item.rows[-1].created_at,
                    before=Version(before.size, None, before.sha256) if before else None,
                    after=self._version(item.after), current=judgement.current, status=judgement.status,
                    conflict_reason=judgement.reason, can_force=judgement.can_force,
                    preview_kind="remove" if item.operation is ChangeOperation.CREATE else "restore"))
        except WorkspaceFileError as error:
            raise app_error(error)
        async with self._read_uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
        entries.sort(key=lambda entry: entry.relative_path)
        return RunChangeList(run_id=run_id, session_id=session_id, session_title=session.title if session else "",
                             run_active=active, entries=entries, kind="undo" if undo_of else "run",
                             undo_of_run_id=undo_of)

    async def _find(self, workspace_id: str, run_id: str, relative_path: str):
        folded, session_id, active, _ = await self._run_changes(workspace_id, run_id)
        item = next((item for item in folded if item.path == relative_path), None)
        if item is None:
            raise NotFoundError("这次运行没有修改该文件")
        return item, session_id, active

    async def preview(self, workspace_id: str, run_id: str, relative_path: str) -> ChangePreview:
        """撤销会把当前内容变成什么：当前版本到将恢复版本的统一 diff；二进制或过大的文件只给大小。"""
        await self._folder(workspace_id)
        item, _, _ = await self._find(workspace_id, run_id, relative_path)
        objects = await self._objects_of(workspace_id, [item])
        result = await self._preview_item(item, objects)
        if item.gap:
            result.warning = GAP_WARNING
        return result

    async def _preview_item(self, item: _Folded, objects: dict[str, WorkspaceObject]) -> ChangePreview:
        before = objects.get(item.before_object_id) if item.before_object_id else None
        path = RootedPath(root_id=item.root_id, relative_path=item.path)
        try:
            try:
                entry = await self._files.stat(path)
            except WorkspaceFileError as error:
                if error.code is not ErrorCode.NOT_FOUND:
                    raise
                entry = None
            if entry is not None and entry.kind is not FileKind.FILE:
                raise BadRequestError("目标现在不是普通文件，无法预览")
            current_size = entry.version.size if entry is not None else None
            restore_size = before.size if before is not None else None
            removes = before is None
            if max(current_size or 0, restore_size or 0) > self._preview_bytes:
                return ChangePreview("too_large", current_size=current_size, restore_size=restore_size,
                                     removes_file=removes)
            current_bytes = await self._files.read_bytes(path, expected=entry.version) if entry is not None else b""
            restore_bytes = await self._objects.read(before) if before is not None else b""
        except WorkspaceFileError as error:
            raise app_error(error)
        if current_bytes == restore_bytes:
            return ChangePreview("unchanged", current_size=current_size, restore_size=restore_size,
                                 removes_file=removes)
        try:
            current_text, restore_text = current_bytes.decode("utf-8"), restore_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return ChangePreview("binary", current_size=current_size, restore_size=restore_size, removes_file=removes)
        if "\x00" in current_text or "\x00" in restore_text:
            return ChangePreview("binary", current_size=current_size, restore_size=restore_size, removes_file=removes)
        lines = list(difflib.unified_diff(current_text.splitlines(keepends=True), restore_text.splitlines(keepends=True),
                                          fromfile="当前", tofile="撤销后", n=3))
        truncated = len(lines) > self._preview_lines
        text = "".join(line if line.endswith("\n") else line + "\n\\ 文件末尾没有换行符\n"
                       for line in lines[:self._preview_lines])
        return ChangePreview("diff", diff=text, truncated=truncated, current_size=current_size,
                             restore_size=restore_size, removes_file=removes)

    # ---- 撤销 ----

    async def undo(self, workspace_id: str, run_id: str, items: list[UndoItem]) -> list[UndoOutcome]:
        if not items:
            raise BadRequestError("没有选择要撤销的文件")
        if len({item.relative_path for item in items}) != len(items):
            raise BadRequestError("同一个文件只能选择一次")
        await self._folder(workspace_id)
        folded, session_id, active, _ = await self._run_changes(workspace_id, run_id)
        if active:
            raise ConflictError("这次运行仍在进行，请先停止或等它结束再撤销")
        by_path = {item.path: item for item in folded}
        missing = [item.relative_path for item in items if item.relative_path not in by_path]
        if missing:
            raise NotFoundError(f"这次运行没有修改：{'、'.join(missing)}")
        objects = await self._objects_of(workspace_id, folded)
        owner = WriteOwner(session_id=session_id, run_id=None, source="undo", operation=f"undo-{uuid.uuid4().hex}",
                           reason=f"撤销运行 {run_id} 的文件修改", undo_of_run_id=run_id)

        async def work() -> list[UndoOutcome]:
            lease_id = await self._leases.acquire(workspace_id, owner, owner.reason)
            try:
                return [await self._undo_one(by_path[item.relative_path], item, objects, owner) for item in items]
            finally:
                await self._leases.release(lease_id)

        try:
            outcomes, cancelled = await run_async_io(work())
        except WorkspaceFileError as error:
            raise app_error(error)
        if cancelled:
            raise asyncio.CancelledError()
        return outcomes

    async def _undo_one(self, item: _Folded, request: UndoItem, objects: dict[str, WorkspaceObject],
                        owner: WriteOwner) -> UndoOutcome:
        path = RootedPath(root_id=item.root_id, relative_path=item.path)
        before = objects.get(item.before_object_id) if item.before_object_id else None
        if item.before_object_id and before is None:
            return UndoOutcome(item.path, "failed", "运行前版本的备份已丢失，无法恢复")
        try:
            judgement = await self._judge(item, before)
            if judgement.status == "restored":
                return UndoOutcome(item.path, "unchanged", "已经是运行前的状态", judgement.current)
            if judgement.status == "conflict":
                forced = judgement.can_force and request.force is not None and self._seen(request.force, judgement)
                if not forced:
                    return UndoOutcome(item.path, "conflict", self._conflict_message(item, judgement),
                                       judgement.current, judgement.reason, judgement.can_force)
            return await self._apply(item, path, before, judgement, owner)
        except WorkspaceFileError as error:
            if error.code is ErrorCode.CONFLICT and "lease" in error.details:
                raise
            if error.code is ErrorCode.CONFLICT:
                return UndoOutcome(item.path, "conflict", f"文件刚刚被改动，请重新查看后再试：{error}",
                                   can_force=before is not None, conflict_reason="modified")
            return UndoOutcome(item.path, "failed", str(error))

    @staticmethod
    def _seen(force: ForceCurrent, judgement: _Judgement) -> bool:
        current = judgement.current
        if current is None:
            return not force.exists
        return force.exists and (force.size, force.modified_ns) == (current.size, current.modified_ns)

    @staticmethod
    def _conflict_message(item: _Folded, judgement: _Judgement) -> str:
        if judgement.reason == "not_file":
            return "目标现在不是普通文件，不自动处理"
        if item.operation is ChangeOperation.CREATE:
            return "这个文件由本次运行新建，之后又被修改，不会自动删除"
        return {"modified": "文件在运行之后又被修改过", "missing": "文件在运行之后被删除",
                "appeared": "运行删除的文件之后又出现了新内容",
                "modified_during_run": "运行期间文件被外部修改过，撤销会同时丢掉那些修改"}[judgement.reason]

    async def _apply(self, item: _Folded, path: RootedPath, before: Optional[WorkspaceObject],
                     judgement: _Judgement, owner: WriteOwner) -> UndoOutcome:
        expected = FileVersion(size=judgement.entry.version.size, modified_ns=judgement.entry.version.modified_ns) \
            if judgement.entry is not None else None
        if before is None:
            await self._writer.delete(path, expected, owner)
            return UndoOutcome(item.path, "removed", "已移除本次运行新建的文件")
        parent = "/".join(path.relative_path.split("/")[:-1])
        if expected is None and parent:
            await self._writer.mkdir(RootedPath(root_id=path.root_id, relative_path=parent), owner)
        stream = await self._objects.open(before)
        try:
            await self._writer.write_stream(path, VerifyingReader(stream, before.sha256), expected, owner)
        finally:
            stream.close()
        return UndoOutcome(item.path, "restored", "已恢复为运行前的版本")
