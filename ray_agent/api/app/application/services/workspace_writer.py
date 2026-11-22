"""工作区文件夹的写入口：准入、写入租约、写前备份与变更记录。

一次写入的顺序是：核对工作区状态 → 取得写租约（被其他会话占用立即冲突）→ 覆盖或删除前把原字节存为归属该工作区的
内容对象（备份失败则不写入）→ 发布 → 记录变更 → 释放租约。整个过程在独立任务里做完再交还取消，租约与变更记录
不会因调用方被取消而半途丢失。发布窗口内文件被外部改动时由文件 IO 报冲突，不宣称已覆盖。
"""
import asyncio
import io
import logging
from typing import BinaryIO, Awaitable, Callable, Optional

from app.application.services.write_leases import WriteLeaseService
from app.domain.external.workspace_files import FileEntry, FileVersion, WorkspaceFileError, WorkspaceFiles
from app.domain.external.workspace_objects import WorkspaceObjects
from app.domain.models.error import ErrorCode
from app.domain.models.file_change import ChangeOperation, ChangeSource, EntryKind, FileChange, VersionStamp
from app.domain.models.identity import RootedPath
from app.domain.models.workspace import WorkspaceStatus
from app.domain.models.write_lease import LeaseState
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_io import run_async_io
from app.domain.services.file_scope import FileWriteGate, WriteOwner
from app.domain.services.file_streams import HashingReader

logger = logging.getLogger(__name__)

_SOURCE_LABELS = {"tool": "文件工具", "upload": "上传文件", "undo": "撤销本次修改", "manual": "文件操作"}


def _source_of(owner: WriteOwner) -> ChangeSource:
    try:
        return ChangeSource(owner.source)
    except ValueError:
        return ChangeSource.TOOL


class WorkspaceWriter(FileWriteGate):

    def __init__(self, files: WorkspaceFiles, uow_factory: Callable[[], IUnitOfWork],
                 read_uow_factory: Callable[[], IUnitOfWork], leases: WriteLeaseService,
                 objects: WorkspaceObjects) -> None:
        self._files, self._uow_factory, self._read_uow_factory = files, uow_factory, read_uow_factory
        self._leases, self._objects = leases, objects

    async def _admit(self, path: RootedPath) -> str:
        """工作区必须存在且未归档；返回工作区身份。"""
        async with self._read_uow_factory() as uow:
            root = await uow.root.get(path.root_id)
            workspace = await uow.workspace.get(root.ref.workspace_id) if root and root.ref.workspace_id else None
        if workspace is None or workspace.status is WorkspaceStatus.DELETING:
            raise WorkspaceFileError(ErrorCode.NOT_FOUND, "工作区不存在")
        if workspace.status is WorkspaceStatus.ARCHIVED:
            raise WorkspaceFileError(ErrorCode.FORBIDDEN, "工作区已归档，不能写入；取消归档后再试")
        return workspace.id

    async def _guarded(self, path: RootedPath, owner: WriteOwner,
                       action: Callable[[str, str], Awaitable]):
        """准入、取租约、执行并释放，作为一个不被取消打断的整体。"""
        reason = owner.reason or f"{_SOURCE_LABELS.get(owner.source, '写入')}写入 {path.relative_path or '根目录'}"

        async def run():
            workspace_id = await self._admit(path)
            lease_id = await self._leases.acquire(workspace_id, owner, reason)
            try:
                return await action(workspace_id, lease_id)
            finally:
                await self._leases.release(lease_id)

        result, cancelled = await run_async_io(run())
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def _backup(self, workspace_id: str, path: RootedPath, expected: FileVersion):
        """被覆盖或删除的原字节保存为工作区的内容对象；任何失败都阻止写入。"""
        try:
            reader = await self._files.open_reader(path, expected)
        except WorkspaceFileError as error:
            if error.code is ErrorCode.NOT_FOUND:
                raise WorkspaceFileError(ErrorCode.CONFLICT, f"{path.relative_path} 已被删除")
            raise
        try:
            return await self._objects.put(workspace_id, reader)
        finally:
            reader.close()

    @staticmethod
    def _change(workspace_id: str, path: RootedPath, owner: WriteOwner, operation: ChangeOperation,
                before_object_id: Optional[str], after: Optional[VersionStamp],
                entry_kind: EntryKind = EntryKind.FILE) -> FileChange:
        source = _source_of(owner)
        # 撤销与界面文件操作没有运行身份：用它们自己的操作身份作为变更记录的归属，使其能被列出并整体撤回
        run_id = owner.run_id or (owner.operation if source in (ChangeSource.UNDO, ChangeSource.MANUAL) else None)
        return FileChange(workspace_id=workspace_id, session_id=owner.session_id, run_id=run_id,
                          tool_call_id=owner.tool_call_id, root_id=path.root_id, relative_path=path.relative_path,
                          operation=operation, source=source, entry_kind=entry_kind,
                          undo_of_run_id=owner.undo_of_run_id, before_object_id=before_object_id, after=after)

    async def _record(self, workspace_id: str, path: RootedPath, owner: WriteOwner, operation: ChangeOperation,
                      before_object_id: Optional[str], after: Optional[VersionStamp],
                      entry_kind: EntryKind = EntryKind.FILE) -> None:
        await self._save(path, [self._change(workspace_id, path, owner, operation, before_object_id, after,
                                             entry_kind)])

    async def _save(self, path: RootedPath, changes: list[FileChange]) -> None:
        """同一组变更在一个事务里保存，要么全部记录要么都不记录。"""
        try:
            async with self._uow_factory() as uow:
                for change in changes:
                    await uow.change.add(change)
        except Exception as error:
            logger.exception("变更记录保存失败 path=%s", path.relative_path)
            raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR,
                                     f"文件已写入，但变更记录保存失败，无法撤销这次修改：{error}")

    async def write_stream(self, path: RootedPath, source: BinaryIO, expected: Optional[FileVersion],
                           owner: WriteOwner) -> FileVersion:
        async def action(workspace_id: str, lease_id: str) -> FileVersion:
            before = await self._backup(workspace_id, path, expected) if expected is not None else None
            await self._leases.mark(lease_id, LeaseState.HELD)
            hashing = HashingReader(source)
            version = await self._files.write_stream(path, hashing, expected)
            stamp = VersionStamp(size=version.size, modified_ns=version.modified_ns, sha256=hashing.hexdigest())
            await self._record(workspace_id, path, owner,
                               ChangeOperation.CREATE if expected is None else ChangeOperation.MODIFY,
                               before.id if before is not None else None, stamp)
            return FileVersion(size=version.size, modified_ns=version.modified_ns, content_hash=stamp.sha256)
        return await self._guarded(path, owner, action)

    async def write_bytes(self, path: RootedPath, data: bytes, expected: Optional[FileVersion],
                          owner: WriteOwner) -> FileVersion:
        return await self.write_stream(path, io.BytesIO(data), expected, owner)

    async def delete(self, path: RootedPath, expected: FileVersion, owner: WriteOwner) -> None:
        async def action(workspace_id: str, lease_id: str) -> None:
            before = await self._backup(workspace_id, path, expected)
            await self._leases.mark(lease_id, LeaseState.HELD)
            await self._files.delete(path, expected)
            await self._record(workspace_id, path, owner, ChangeOperation.DELETE, before.id, None)
        await self._guarded(path, owner, action)

    async def mkdir(self, path: RootedPath, owner: WriteOwner) -> FileEntry:
        async def action(workspace_id: str, lease_id: str) -> FileEntry:
            return await self._files.mkdir(path, parents=True)
        return await self._guarded(path, owner, action)

    async def create_dir(self, path: RootedPath, owner: WriteOwner) -> FileEntry:
        """界面新建文件夹：父目录必须已存在，同名即冲突，并记录为可撤销的变更。"""
        async def action(workspace_id: str, lease_id: str) -> FileEntry:
            await self._leases.mark(lease_id, LeaseState.HELD)
            entry = await self._files.mkdir(path, parents=False, exclusive=True)
            await self._record(workspace_id, path, owner, ChangeOperation.CREATE, None, None, EntryKind.DIRECTORY)
            return entry
        return await self._guarded(path, owner, action)

    async def remove_dir(self, path: RootedPath, owner: WriteOwner) -> None:
        """界面删除空文件夹：非空即冲突；记录删除，撤销时重新建立空文件夹。"""
        async def action(workspace_id: str, lease_id: str) -> None:
            await self._leases.mark(lease_id, LeaseState.HELD)
            await self._files.rmdir(path)
            await self._record(workspace_id, path, owner, ChangeOperation.DELETE, None, None, EntryKind.DIRECTORY)
        await self._guarded(path, owner, action)

    async def rename(self, path: RootedPath, target: RootedPath, expected: FileVersion,
                     owner: WriteOwner) -> FileEntry:
        """普通文件改名：原名记为删除（保存写前备份），新名记为创建，两条变更同一事务保存，撤销时整组回退。"""
        async def action(workspace_id: str, lease_id: str) -> FileEntry:
            before = await self._backup(workspace_id, path, expected)
            await self._leases.mark(lease_id, LeaseState.HELD)
            await self._files.move(path, target, expected)
            stamped = await self._files.stat(target, with_hash=True)
            version = stamped.version
            if version is None:
                raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR, "改名后无法读取新名称的版本")
            after = VersionStamp(size=version.size, modified_ns=version.modified_ns, sha256=version.content_hash)
            await self._save(path, [
                self._change(workspace_id, path, owner, ChangeOperation.DELETE, before.id, None),
                self._change(workspace_id, target, owner, ChangeOperation.CREATE, None, after),
            ])
            return stamped
        return await self._guarded(path, owner, action)
