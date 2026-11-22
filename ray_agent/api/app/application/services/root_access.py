"""可访问根的应用层入口：按 root_id 解析位置、工作区文件夹的唯一写入入口，以及按根读写文件的接口服务。

文件夹工作区的写入都经 WorkspaceWriter（见 workspace_writer.py）：准入、写租约、写前备份与变更记录，调用方传入的
WriteOwner 携带会话、运行与工具调用身份。
"""
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Awaitable, Optional

from app.application.errors.exceptions import BadRequestError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.application.services.workspace_writer import WorkspaceWriter
from app.domain.external.workspace_folders import FolderAccess
from app.domain.external.workspace_files import (
    DirectoryListing, FileEntry, FileKind, FileLimits, FileVersion, RootBinding, WorkspaceFileError, WorkspaceFiles,
)
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootKind, RootedPath, relative_parts
from app.domain.models.workspace import RootRecord
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_rules import check_entry_name, denied_reason, safe_filename
from app.domain.services.file_scope import AccessibleRoot, FileScope, FileWriteGate, WriteOwner
from app.infrastructure.external.workdir.session_workdir import SESSIONS_DIR, SessionWorkdir, SessionWorkdirs


RootResolver = Callable[[str], Awaitable[RootBinding]]


def binding_of(record: RootRecord, data_root: Path) -> RootBinding:
    """登记的根在本机的位置：工作区文件夹是绝对路径并带文件系统身份，会话工作目录相对数据根。"""
    if record.ref.kind is RootKind.WORKSPACE_FOLDER:
        return RootBinding(root_id=record.ref.root_id, kind=record.ref.kind, path=record.location,
                           dev=record.dev, ino=record.ino)
    path = (data_root / record.location).resolve()
    if path.parent != (data_root / SESSIONS_DIR).resolve():
        raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR, "会话工作目录位置异常")
    return RootBinding(root_id=record.ref.root_id, kind=record.ref.kind, path=str(path))


class RootBindings:
    """从业务库解析 root_id 的位置，供 HTTP 文件接口使用。"""

    def __init__(self, read_uow_factory: Callable[[], IUnitOfWork], data_root: Path) -> None:
        self._read_uow_factory, self._data_root = read_uow_factory, data_root

    async def record(self, root_id: str) -> RootRecord:
        async with self._read_uow_factory() as uow:
            record = await uow.root.get(root_id)
        if record is None:
            raise WorkspaceFileError(ErrorCode.NOT_FOUND, "文件根不存在")
        return record

    async def __call__(self, root_id: str) -> RootBinding:
        return binding_of(await self.record(root_id), self._data_root)


class StaticBindings:
    """运行期间固定的根位置：运行创建时登记，工具调用不再访问业务库。"""

    def __init__(self, bindings: list[RootBinding]) -> None:
        self._bindings = {binding.root_id: binding for binding in bindings}

    async def __call__(self, root_id: str) -> RootBinding:
        try:
            return self._bindings[root_id]
        except KeyError:
            raise WorkspaceFileError(ErrorCode.NOT_FOUND, "文件根不存在")


def accessible(binding: RootBinding) -> AccessibleRoot:
    return AccessibleRoot(root_id=binding.root_id, path=binding.path, kind=binding.kind)


def build_scope(files: WorkspaceFiles, bindings: list[RootBinding], *, gate: Optional[FileWriteGate],
                owner: WriteOwner, limits: FileLimits, working_root_id: Optional[str],
                gated_root_id: Optional[str]) -> FileScope:
    """一次运行的可访问范围：working_root_id 指定的根作为工作目录（缺省为第一个根），gated_root_id 的写入经 gate。"""
    roots = [accessible(binding) for binding in bindings]
    working = next((root for root in roots if root.root_id == working_root_id), None) or roots[0]
    return FileScope(files, roots, working=working, limits=limits, gate=gate, gated_root_id=gated_root_id, owner=owner)


class RootFileService:
    """按 root_id 加相对路径读写文件的接口服务：列目录、读元数据与内容、放入文件；接口不接受桌面绝对路径。"""

    def __init__(self, bindings: RootBindings, files: WorkspaceFiles, writer: WorkspaceWriter) -> None:
        self._bindings, self._files, self._writer = bindings, files, writer

    @staticmethod
    def path(root_id: str, relative: str) -> RootedPath:
        try:
            return RootedPath(root_id=root_id, relative_path=relative)
        except ValueError as error:
            raise BadRequestError(f"路径无效：{error}")

    async def list(self, root_id: str, relative: str = "") -> DirectoryListing:
        try:
            return await self._files.list_dir(self.path(root_id, relative))
        except WorkspaceFileError as error:
            raise app_error(error)

    async def stat(self, root_id: str, relative: str = "") -> FileEntry:
        try:
            return await self._files.stat(self.path(root_id, relative))
        except WorkspaceFileError as error:
            raise app_error(error)

    async def read(self, root_id: str, relative: str, offset: int, length: Optional[int]) -> tuple[bytes, FileEntry]:
        path = self.path(root_id, relative)
        try:
            entry = await self._files.stat(path)
            if entry.kind is not FileKind.FILE:
                raise BadRequestError("目标不是普通文件")
            return await self._files.read_bytes(path, offset, length, expected=entry.version), entry
        except WorkspaceFileError as error:
            raise app_error(error)

    async def locate(self, root_id: str, relative: str = "") -> str:
        """宿主在系统文件管理器里「显示位置」前的解析：按根身份与路径规则核对，返回现存目标的绝对路径。

        拒绝保留目录、版本控制内部与凭据数据库路径，目标必须存在且是文件或目录；路径只用于展示，不再经本接口读写。"""
        target = self.path(root_id, relative)
        try:
            record = await self._bindings.record(root_id)
            if record.ref.kind is RootKind.WORKSPACE_FOLDER and (reason := denied_reason(relative_parts(relative))):
                raise WorkspaceFileError(ErrorCode.FORBIDDEN, reason)
            entry = await self._files.stat(target)
            if entry.kind not in (FileKind.FILE, FileKind.DIRECTORY):
                raise WorkspaceFileError(ErrorCode.FORBIDDEN, "只能显示普通文件或目录的位置")
            binding = await self._bindings(root_id)
        except WorkspaceFileError as error:
            raise app_error(error)
        return os.path.join(binding.path, *relative_parts(relative))

    async def add_file(self, root_id: str, directory: str, filename: str, source: BinaryIO) -> FileEntry:
        """上传的文件复制进工作区文件夹：默认放在根目录，可指定子目录；同名不覆盖。"""
        try:
            record = await self._bindings.record(root_id)
        except WorkspaceFileError as error:
            raise app_error(error)
        if record.ref.kind is not RootKind.WORKSPACE_FOLDER:
            raise BadRequestError("只能向工作区文件夹添加文件")
        try:
            name = safe_filename(filename)
        except ValueError as error:
            raise BadRequestError(str(error))
        target_dir = self.path(root_id, directory)
        if reason := denied_reason((*relative_parts(directory), name)):
            raise app_error(WorkspaceFileError(ErrorCode.FORBIDDEN, f"不能放进工作区文件夹：{reason}"))
        scope = FileScope(self._files, [], limits=getattr(self._files, "limits", None), gate=self._writer,
                          gated_root_id=root_id, owner=WriteOwner(session_id="", source="upload"))
        try:
            target, _ = await scope.write_unique(target_dir, name, source)
            return await self._files.stat(target)
        except WorkspaceFileError as error:
            raise app_error(error)


    # ---- 界面文件操作：删除、重命名、新建文件夹。经同一写入口，记为 manual 变更，可在「最近修改」中撤销 ----

    async def _writable_folder(self, root_id: str) -> None:
        try:
            record = await self._bindings.record(root_id)
        except WorkspaceFileError as error:
            raise app_error(error)
        if record.ref.kind is not RootKind.WORKSPACE_FOLDER:
            raise BadRequestError("只能在工作区文件夹里操作文件")

    @staticmethod
    def _manual_owner(reason: str) -> WriteOwner:
        """界面文件操作的归属：没有会话与运行，操作身份作为变更记录的归属，使其可列出并整体撤回。"""
        return WriteOwner(session_id="", source="manual", operation=f"manual-{uuid.uuid4().hex}", reason=reason)

    @staticmethod
    def _check_denied(parts: tuple[str, ...]) -> None:
        if reason := denied_reason(parts):
            raise app_error(WorkspaceFileError(ErrorCode.FORBIDDEN, f"不能操作：{reason}"))

    @staticmethod
    def _entry_name(name: str) -> str:
        try:
            return check_entry_name(name)
        except ValueError as error:
            raise BadRequestError(str(error))

    async def delete_entry(self, root_id: str, relative: str,
                           expected: Optional[FileVersion]) -> tuple[RootedPath, FileKind]:
        """删除普通文件（需带当前版本）或空文件夹；非空文件夹、链接与特殊文件不删除。"""
        await self._writable_folder(root_id)
        parts = relative_parts(relative)
        if not parts:
            raise BadRequestError("不能删除工作区根目录")
        self._check_denied(parts)
        path = self.path(root_id, relative)
        try:
            entry = await self._files.stat(path)
            if entry.kind is FileKind.FILE:
                if expected is None:
                    raise BadRequestError("删除文件需要带上当前版本")
                await self._writer.delete(path, expected, self._manual_owner(f"界面删除 {parts[-1]}"))
            elif entry.kind is FileKind.DIRECTORY:
                await self._writer.remove_dir(path, self._manual_owner(f"界面删除文件夹 {parts[-1]}"))
            else:
                raise BadRequestError("只能删除普通文件或空文件夹")
        except WorkspaceFileError as error:
            raise app_error(error)
        return path, entry.kind

    async def rename_entry(self, root_id: str, relative: str, name: str,
                           expected: Optional[FileVersion]) -> FileEntry:
        """同一文件夹内改名普通文件；目标已存在即冲突，不覆盖。"""
        await self._writable_folder(root_id)
        parts = relative_parts(relative)
        if not parts:
            raise BadRequestError("不能重命名工作区根目录")
        self._check_denied(parts)
        new_name = self._entry_name(name)
        if new_name == parts[-1]:
            raise BadRequestError("名称没有变化")
        target_parts = (*parts[:-1], new_name)
        self._check_denied(target_parts)
        source = self.path(root_id, "/".join(parts))
        target = self.path(root_id, "/".join(target_parts))
        try:
            entry = await self._files.stat(source)
            if entry.kind is FileKind.DIRECTORY:
                raise BadRequestError("暂不支持重命名文件夹")
            if entry.kind is not FileKind.FILE:
                raise BadRequestError("只能重命名普通文件")
            if expected is None:
                raise BadRequestError("重命名需要带上当前版本")
            return await self._writer.rename(source, target, expected,
                                             self._manual_owner(f"界面重命名 {parts[-1]}"))
        except WorkspaceFileError as error:
            raise app_error(error)

    async def create_folder(self, root_id: str, directory: str, name: str) -> FileEntry:
        """在已存在的文件夹里新建子文件夹；同名已存在即冲突。"""
        await self._writable_folder(root_id)
        new_name = self._entry_name(name)
        dir_parts = relative_parts(directory)
        target_parts = (*dir_parts, new_name)
        self._check_denied(target_parts)
        parent = self.path(root_id, "/".join(dir_parts))
        target = self.path(root_id, "/".join(target_parts))
        try:
            parent_entry = await self._files.stat(parent)
            if parent_entry.kind is not FileKind.DIRECTORY:
                raise BadRequestError("只能在文件夹里新建文件夹")
            return await self._writer.create_dir(target, self._manual_owner(f"界面新建文件夹 {new_name}"))
        except WorkspaceFileError as error:
            raise app_error(error)


@dataclass
class RunFiles:
    """一次运行的文件上下文：可访问范围、工作区文件夹（若有）及其不可用原因。"""
    scope: FileScope
    workdir: SessionWorkdir
    workspace: Optional[RootBinding] = None
    workspace_problem: Optional[str] = None


class RunFileAccess:
    """为会话的一次运行组装可访问范围：绑定了工作区的会话是工作区文件夹加会话工作目录，独立对话只有会话工作目录。

    工作区文件夹按需核对：失联时仍留在范围里（文件工具对它返回不可用），但工作目录退回会话工作目录。"""

    def __init__(self, read_uow_factory: Callable[[], IUnitOfWork], workdirs: SessionWorkdirs, limits: FileLimits,
                 folders: FolderAccess, files_factory: Callable[[RootResolver, FileLimits], WorkspaceFiles],
                 writer_factory: Callable[[WorkspaceFiles], WorkspaceWriter]) -> None:
        self._read_uow_factory, self._workdirs, self._limits = read_uow_factory, workdirs, limits
        self._folders, self._files_factory, self._writer_factory = folders, files_factory, writer_factory

    async def open(self, session_id: str, workspace_id: Optional[str], run_id: Optional[str], *,
                   ensure: bool = False) -> Optional[RunFiles]:
        async with self._read_uow_factory() as uow:
            registered = await uow.root.session_workdir(session_id)
            folder = await uow.root.workspace_folder(workspace_id) if workspace_id else None
        if registered is None:
            return None
        workdir = self._workdirs.resolve(*registered)
        if ensure:
            workdir.ensure()
        scratch = RootBinding(root_id=workdir.root.root_id, kind=RootKind.SESSION_WORKDIR,
                              path=os.path.realpath(workdir.path))
        bindings, problem, workspace = [scratch], None, None
        if folder is not None:
            workspace = RootBinding(root_id=folder.ref.root_id, kind=RootKind.WORKSPACE_FOLDER,
                                    path=folder.location, dev=folder.dev, ino=folder.ino)
            reason = "文件夹不存在、已移动或已被替换"
            try:
                matched = folder.dev is not None and await self._folders.matches(folder.location, folder.dev,
                                                                                 folder.ino)
            except WorkspaceFileError as error:
                matched, reason = False, f"无法核对文件夹：{error}"
            if matched:
                bindings.insert(0, workspace)
            else:
                bindings.append(workspace)
                problem = reason
        elif workspace_id:
            problem = "工作区没有绑定文件夹"
        files = self._files_factory(StaticBindings(bindings), self._limits)
        gate = self._writer_factory(files) if workspace is not None else None
        scope = build_scope(files, bindings, gate=gate, owner=WriteOwner(session_id=session_id, run_id=run_id),
                            limits=self._limits, gated_root_id=workspace.root_id if workspace is not None else None,
                            working_root_id=workspace.root_id if workspace is not None and problem is None else None)
        return RunFiles(scope=scope, workdir=workdir, workspace=workspace, workspace_problem=problem)
