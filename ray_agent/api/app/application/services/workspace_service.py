"""文件夹工作区的生命周期：新建、打开、识别移动与复制、重命名、归档、删除、可用性核对与默认位置。

文件夹的来源只有两个：默认位置下新建，或宿主选择器产生的一次性授权；界面不能直接提交桌面路径。
打开已有文件夹时先读它的身份标记：标记里有本机已知的工作区，原文件夹已不在则视为移动并改绑，原文件夹仍在则是复制，
返回冲突让用户在「作为新工作区」与「改绑到这里」之间选择，同一个工作区不会同时绑定两个文件夹。
"""
import asyncio
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, List, Literal, Optional

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.application.services.background_jobs import JobContext, cleanup_handler
from app.application.services.folder_grants import FolderGrants
from app.application.services.folder_policy import FolderPolicy
from app.application.services.write_leases import lease_details
from app.domain.external.workspace_files import ScanSummary, WorkspaceFileError
from app.domain.external.workspace_folders import FolderAccess
from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.identity import RootKind, RootRef
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind
from app.domain.models.workspace import (
    WORKSPACE_NAME_MAX_LENGTH, ConflictResolution, FolderInspection, FolderStatus, MarkerConflict, RootRecord,
    Workspace, WorkspaceStatus,
)
from app.domain.models.write_lease import LeaseState, WriteLease
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)

FOLDER_NAME_MAX_LENGTH = 60
CONFLICT_CAPACITY = 32
TEMP_MAX_AGE_SECONDS = 3600  # 崩溃残留的写入临时文件超过这个年龄才清理，避免误伤正在进行的写入
DELETE_QUIESCE_SECONDS = 10  # 删除工作区前等待文件夹里的写入者静止的最长时间
INSTRUCTION_PREVIEW_CHARS = 120  # 工作区列表里工作方式预览的长度
_UNSAFE = re.compile(r"[\\/:\x00-\x1f\x7f]")


def same_folder(record: RootRecord, inspection: FolderInspection, install_id: str) -> bool:
    """检查到的文件夹就是这条登记：文件系统身份相同；或路径与 inode 相同、仅设备号变化（外接卷重新挂载），
    后者还要求标记里本机条目指向同一个工作区，避免另一块恰好挂载在同一路径、根目录 inode 相同的盘被认作它。"""
    if (record.dev, record.ino) == (inspection.dev, inspection.ino):
        return True
    if record.ino == inspection.ino and record.location == inspection.path and inspection.marker is not None:
        entry = inspection.marker.entry_for(install_id)
        return entry is not None and entry.workspace_id == record.ref.workspace_id
    return False


@dataclass
class WorkspaceView:
    workspace: Workspace
    folder: Optional[RootRecord]
    lease: Optional[WriteLease] = None  # 文件夹当前的写入租约
    instruction_preview: Optional[str] = None  # 当前工作方式的开头，空表示尚未设置


@dataclass
class OpenResult:
    status: Literal["opened", "conflict"]
    view: Optional[WorkspaceView] = None
    scan: Optional[ScanSummary] = None
    conflict: Optional[MarkerConflict] = None
    recognized: Optional[Literal["new", "existing", "moved"]] = None  # 打开了新工作区、已有工作区，或识别出移动并改绑


@dataclass
class _Pending:
    inspection: FolderInspection
    workspace_id: str
    expires_at: float


@dataclass
class WorkspaceRuntime:
    """跨请求共享的内存状态：授权凭证、等待选择的复制冲突与串行化生命周期操作的锁。"""
    grants: FolderGrants
    conflict_seconds: float = 600
    conflicts: dict[str, _Pending] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


async def wipe_workspace_memory(uow: IUnitOfWork, workspace_id: str) -> None:
    """删除工作区的记忆、摘要、运行背景清单、工作方式与检索文档；可重复执行。模板属于应用，不在此列。"""
    await uow.memory.delete_workspace(workspace_id)
    await uow.summary.delete_workspace(workspace_id)
    await uow.run_context.delete_workspace(workspace_id)
    await uow.instruction.delete_workspace(workspace_id)
    await uow.search.delete_workspace(workspace_id)


def instruction_preview(body: Optional[str]) -> Optional[str]:
    text = " ".join((body or "").split())
    if not text:
        return None
    return text if len(text) <= INSTRUCTION_PREVIEW_CHARS else text[:INSTRUCTION_PREVIEW_CHARS] + "…"


def folder_name(name: str) -> str:
    """工作区名称转成文件夹名：去掉路径分隔与控制字符，不以点开头（不产生隐藏目录或 `..`），长度受限。"""
    cleaned = _UNSAFE.sub("-", name).strip().lstrip(".").strip()[:FOLDER_NAME_MAX_LENGTH].strip()
    return cleaned or "Workspace"


def valid_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise BadRequestError("工作区名称不能为空")
    if len(cleaned) > WORKSPACE_NAME_MAX_LENGTH:
        raise BadRequestError(f"工作区名称最多 {WORKSPACE_NAME_MAX_LENGTH} 个字符")
    if any(ord(char) < 32 or ord(char) == 127 for char in cleaned):
        raise BadRequestError("工作区名称不能包含控制字符")
    return cleaned


class WorkspaceService:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
                 folders: FolderAccess, policy: FolderPolicy, runtime: WorkspaceRuntime, install_id: str,
                 default_location: str, jobs=None, task_cls=None,
                 quiesce_seconds: float = DELETE_QUIESCE_SECONDS) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._folders = folders
        self._policy = policy
        self._runtime = runtime
        self._install_id = install_id
        self._fallback_location = default_location
        self._jobs = jobs
        self._task_cls = task_cls
        self._quiesce_seconds = quiesce_seconds

    # ---- 查询与可用性 ----

    async def _refresh(self, records: list[RootRecord]) -> list[RootRecord]:
        """按需核对文件夹：路径缺失或文件系统身份不符即不可用；状态变化时写回。"""
        async def check(record: RootRecord) -> RootRecord:
            if record.dev is None or record.ino is None:
                return record
            try:
                ok = await self._folders.matches(record.location, record.dev, record.ino)
            except WorkspaceFileError as error:
                logger.warning("无法核对工作区文件夹，保持原状态 path=%s: %s", record.location, error)
                return record
            status = FolderStatus.AVAILABLE if ok else FolderStatus.UNAVAILABLE
            return record.model_copy(update={"status": status, "checked_at": utc_now()})

        checked = await asyncio.gather(*(check(record) for record in records))
        changed = [after for before, after in zip(records, checked) if before.status != after.status]
        if changed:
            async with self._uow_factory() as uow:
                for record in changed:
                    await uow.root.set_folder_state(record.ref.root_id, record.status, record.checked_at)
        return list(checked)

    async def list(self) -> list[WorkspaceView]:
        async with self._read_uow_factory() as uow:
            workspaces = await uow.workspace.list()
            folders = {record.ref.workspace_id: record for record in await uow.root.workspace_folders()}
            leases = {lease.workspace_id: lease for lease in await uow.lease.list()}
            previews = {}
            for w in workspaces:
                record = await uow.instruction.get_version(w.id, w.instruction_version) if w.instruction_version else None
                previews[w.id] = instruction_preview(record.body if record else None)
        refreshed = await self._refresh([folders[w.id] for w in workspaces if w.id in folders])
        by_workspace = {record.ref.workspace_id: record for record in refreshed}
        return [WorkspaceView(w, by_workspace.get(w.id), leases.get(w.id), previews.get(w.id)) for w in workspaces]

    async def get(self, workspace_id: str, *, refresh: bool = True) -> WorkspaceView:
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            folder = await uow.root.workspace_folder(workspace_id) if workspace else None
            lease = await uow.lease.get(workspace_id) if workspace else None
            record = await uow.instruction.get_version(workspace_id, workspace.instruction_version) \
                if workspace and workspace.instruction_version else None
        if workspace is None or workspace.status is WorkspaceStatus.DELETING:
            raise NotFoundError("工作区不存在")
        if folder is not None and refresh:
            folder = (await self._refresh([folder]))[0]
        return WorkspaceView(workspace, folder, lease, instruction_preview(record.body if record else None))

    async def recheck(self, workspace_id: str) -> WorkspaceView:
        return await self.get(workspace_id, refresh=True)

    # ---- 默认位置 ----

    async def default_location(self) -> str:
        async with self._read_uow_factory() as uow:
            stored = await uow.workspace.default_location()
        return os.path.abspath(os.path.expanduser(stored or self._fallback_location))

    async def set_default_location(self, grant_id: str) -> str:
        path = self._runtime.grants.redeem(grant_id)
        inspection = await self._inspect(path)
        async with self._read_uow_factory() as uow:
            others = await uow.root.workspace_folders()
        self._policy.check_location(inspection.path, others)
        async with self._uow_factory() as uow:
            await uow.workspace.set_default_location(inspection.path)
        return inspection.path

    # ---- 新建 ----

    async def create(self, name: str) -> WorkspaceView:
        name = valid_name(name)
        async with self._runtime.lock:
            parent = await self.default_location()
            async with self._read_uow_factory() as uow:
                others = await uow.root.workspace_folders()
            self._policy.check_location(os.path.realpath(parent), others)
            try:
                path = await self._folders.create_folder(parent, folder_name(name))
            except WorkspaceFileError as error:
                raise app_error(error)
            try:
                inspection = await self._inspect(path)
                self._policy.check_workspace(inspection.path, others)
                return await self._register(name, inspection)
            except BaseException:
                await self._folders.remove_empty_folder(path)  # 刚建的空目录；有内容时不删
                raise

    async def _register(self, name: str, inspection: FolderInspection, workspace_id: Optional[str] = None) -> WorkspaceView:
        workspace = Workspace(name=name)
        if workspace_id:
            workspace.id = workspace_id
        root = RootRef(root_id=uuid.uuid4().hex, kind=RootKind.WORKSPACE_FOLDER, workspace_id=workspace.id)
        workspace.folder_root_id = root.root_id
        writable = await self._write_marker(inspection, workspace.id)
        try:
            async with self._uow_factory() as uow:
                await uow.workspace.add(workspace)
                await uow.root.add(root, inspection.path, dev=inspection.dev, ino=inspection.ino,
                                   marker_writable=writable)
        except BaseException:
            await self._folders.remove_marker(inspection.path, inspection.dev, inspection.ino, self._install_id,
                                              workspace.id)
            raise
        return await self.get(workspace.id, refresh=False)

    async def _write_marker(self, inspection: FolderInspection, workspace_id: str) -> bool:
        try:
            await self._folders.write_marker(inspection.path, inspection.dev, inspection.ino, self._install_id,
                                             workspace_id)
            return True
        except WorkspaceFileError as error:
            logger.warning("工作区身份标记写入失败，改用路径与文件系统身份绑定：%s", error)
            return False

    # ---- 打开已有文件夹 ----

    async def _inspect(self, path: str) -> FolderInspection:
        try:
            return await self._folders.inspect(path)
        except WorkspaceFileError as error:
            raise app_error(error)

    async def open_folder(self, grant_id: str, name: Optional[str] = None) -> OpenResult:
        path = self._runtime.grants.redeem(grant_id)
        inspection = await self._inspect(path)
        async with self._runtime.lock:
            async with self._read_uow_factory() as uow:
                folders = await uow.root.workspace_folders()
            same = next((record for record in folders if same_folder(record, inspection, self._install_id)), None)
            if same is not None:
                return await self._reopen(same, inspection, folders)
            self._policy.check_workspace(inspection.path, folders)
            known = await self._known_workspace(inspection)
            if known is not None:
                workspace, bound = known
                if bound is None or not await self._bound_present(bound):
                    return await self._rebind(workspace, bound, inspection)
                return self._conflict(inspection, workspace, bound)
            default_name = valid_name(name or os.path.basename(inspection.path) or "Workspace")
            view = await self._register(default_name, inspection)
            return OpenResult("opened", view=view, scan=await self._scan(inspection), recognized="new")

    async def _known_workspace(self, inspection: FolderInspection):
        """标记里本机条目指向的、仍存在且未在删除中的工作区及其当前绑定。"""
        entry = inspection.marker.entry_for(self._install_id) if inspection.marker else None
        if entry is None:
            return None
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(entry.workspace_id)
            bound = await uow.root.workspace_folder(entry.workspace_id) if workspace else None
        if workspace is None or workspace.status is WorkspaceStatus.DELETING:
            return None
        return workspace, bound

    async def _bound_present(self, bound: RootRecord) -> bool:
        """登记的文件夹仍在原处（身份也相符）；无法判断时按仍在，让用户在冲突里选择，不静默改绑。"""
        if bound.dev is None:
            return await self._folders.exists(bound.location)
        try:
            return await self._folders.matches(bound.location, bound.dev, bound.ino)
        except WorkspaceFileError:
            return True

    async def _tidy(self, path: str, dev: int, ino: int) -> None:
        try:
            removed = await self._folders.sweep_temp(path, dev, ino, TEMP_MAX_AGE_SECONDS)
            if removed:
                logger.info("清理崩溃残留的写入临时文件 path=%s count=%d", path, removed)
        except Exception as error:
            logger.warning("清理写入临时文件失败 path=%s: %s", path, error)

    async def tidy_folders(self) -> None:
        """核心启动后在后台清理各个可用工作区文件夹里崩溃残留的写入临时文件。"""
        async with self._read_uow_factory() as uow:
            folders = await uow.root.workspace_folders()
        for record in folders:
            if record.dev is not None and await self._bound_present(record):
                await self._tidy(record.location, record.dev, record.ino)

    async def _scan(self, inspection: FolderInspection) -> ScanSummary:
        await self._tidy(inspection.path, inspection.dev, inspection.ino)
        try:
            return await self._folders.scan(inspection.path, inspection.dev, inspection.ino)
        except WorkspaceFileError as error:
            raise app_error(error)

    async def _reopen(self, record: RootRecord, inspection: FolderInspection,
                      folders: List[RootRecord]) -> OpenResult:
        """同一个文件夹（文件系统身份相同）再次打开：路径变化则校验后改绑，标记缺失则补写。"""
        workspace_id = record.ref.workspace_id
        self._policy.check_workspace(inspection.path, folders, ignore_workspace_id=workspace_id)
        moved = record.location != inspection.path
        if moved:
            async with self._read_uow_factory() as uow:
                workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            await self._bind(workspace, record, inspection)
        elif record.dev != inspection.dev or not record.marker_writable or inspection.marker is None \
                or (entry := inspection.marker.entry_for(self._install_id)) is None \
                or entry.workspace_id != workspace_id:
            writable = await self._write_marker(inspection, workspace_id)
            async with self._uow_factory() as uow:
                await uow.root.rebind_folder(record.ref.root_id, location=inspection.path, dev=inspection.dev,
                                             ino=inspection.ino, marker_writable=writable, checked_at=utc_now())
        view = await self.get(workspace_id)
        return OpenResult("opened", view=view, scan=await self._scan(inspection),
                          recognized="moved" if moved else "existing")

    async def _rebind(self, workspace: Workspace, bound: Optional[RootRecord], inspection: FolderInspection
                      ) -> OpenResult:
        async with self._read_uow_factory() as uow:
            folders = await uow.root.workspace_folders()
        self._policy.check_workspace(inspection.path, folders, ignore_workspace_id=workspace.id)
        await self._bind(workspace, bound, inspection)
        view = await self.get(workspace.id, refresh=False)
        return OpenResult("opened", view=view, scan=await self._scan(inspection), recognized="moved")

    async def _bind(self, workspace: Workspace, bound: Optional[RootRecord], inspection: FolderInspection) -> None:
        """把工作区绑定到检查过的文件夹的唯一提交点（打开时识别移动、解决复制冲突、手动重新定位都经此）。

        调用方已完成嵌套、系统目录与数据根校验。没有写入者才改绑：租约与活动运行先查一次，写事务里再查一次，
        所以写入不会落在旧位置与新位置之间。标记尽力写入新位置，提交失败时撤回；成功后移除旧位置的本机条目。"""
        await self._ensure_idle(workspace.id)
        writable = await self._write_marker(inspection, workspace.id)
        try:
            async with self._uow_factory() as uow:
                await self._ensure_idle(workspace.id, uow)
                if bound is None:
                    root = RootRef(root_id=uuid.uuid4().hex, kind=RootKind.WORKSPACE_FOLDER,
                                   workspace_id=workspace.id)
                    await uow.root.add(root, inspection.path, dev=inspection.dev, ino=inspection.ino,
                                       marker_writable=writable)
                    root_id = root.root_id
                else:
                    await uow.root.rebind_folder(bound.ref.root_id, location=inspection.path, dev=inspection.dev,
                                                 ino=inspection.ino, marker_writable=writable, checked_at=utc_now())
                    root_id = bound.ref.root_id
                if await uow.workspace.update(workspace.id, workspace.version, folder_root_id=root_id) is None:
                    raise ConflictError("工作区已被修改，请刷新后重试")
        except BaseException:
            if bound is None or (bound.dev, bound.ino) != (inspection.dev, inspection.ino):
                await self._folders.remove_marker(inspection.path, inspection.dev, inspection.ino, self._install_id,
                                                  workspace.id)
            raise
        if bound is not None and bound.dev is not None and (bound.dev, bound.ino) != (inspection.dev, inspection.ino):
            await self._folders.remove_marker(bound.location, bound.dev, bound.ino, self._install_id, workspace.id)

    def _conflict(self, inspection: FolderInspection, workspace: Workspace, bound: RootRecord) -> OpenResult:
        now = time.monotonic()
        conflicts = self._runtime.conflicts
        for key in [key for key, item in conflicts.items() if item.expires_at <= now]:
            del conflicts[key]
        while len(conflicts) >= CONFLICT_CAPACITY:
            del conflicts[min(conflicts, key=lambda key: conflicts[key].expires_at)]
        conflict_id = uuid.uuid4().hex
        conflicts[conflict_id] = _Pending(inspection, workspace.id, now + self._runtime.conflict_seconds)
        return OpenResult("conflict", conflict=MarkerConflict(
            conflict_id=conflict_id, path=inspection.path, workspace_id=workspace.id, workspace_name=workspace.name,
            bound_path=bound.location))

    async def resolve_conflict(self, conflict_id: str, resolution: ConflictResolution) -> OpenResult:
        async with self._runtime.lock:
            pending = self._runtime.conflicts.pop(conflict_id, None)
            if pending is None or pending.expires_at <= time.monotonic():
                raise NotFoundError("该冲突已过期或已处理，请重新选择文件夹")
            inspection = pending.inspection
            if not await self._folders.matches(inspection.path, inspection.dev, inspection.ino):
                raise ConflictError("文件夹已变化，请重新选择")
            async with self._read_uow_factory() as uow:
                folders = await uow.root.workspace_folders()
                workspace = await uow.workspace.get(pending.workspace_id)
                bound = await uow.root.workspace_folder(pending.workspace_id) if workspace else None
            if any(same_folder(record, inspection, self._install_id) for record in folders):
                raise ConflictError("该文件夹已绑定到工作区，请重新选择文件夹")
            if resolution is ConflictResolution.AS_NEW:
                self._policy.check_workspace(inspection.path, folders)
                view = await self._register(valid_name(os.path.basename(inspection.path) or "Workspace"), inspection)
                return OpenResult("opened", view=view, scan=await self._scan(inspection), recognized="new")
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("原工作区已不存在，请重新选择文件夹")
            self._policy.check_workspace(inspection.path, folders, ignore_workspace_id=workspace.id)
            return await self._rebind(workspace, bound, inspection)

    async def relocate(self, workspace_id: str, grant_id: str, version: int) -> WorkspaceView:
        """显式改绑：把工作区绑定到用户选定的另一个文件夹，不依赖身份标记（标记不可写也能用）。
        校验同打开；目标已绑定其他工作区、标记属于本机另一个工作区，或有写入租约、活动运行时返回冲突。"""
        path = self._runtime.grants.redeem(grant_id)
        inspection = await self._inspect(path)
        async with self._runtime.lock:
            async with self._read_uow_factory() as uow:
                workspace = await uow.workspace.get(workspace_id)
                folders = await uow.root.workspace_folders()
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            if workspace.version != version:
                raise ConflictError("工作区已被修改，请刷新后重试", resource_version=workspace.version)
            bound = next((record for record in folders if record.ref.workspace_id == workspace_id), None)
            await self._check_target(workspace_id, inspection, folders)
            await self._bind(workspace, bound, inspection)
        return await self.get(workspace_id)

    async def _check_target(self, workspace_id: str, inspection: FolderInspection, folders: List[RootRecord]) -> None:
        same = next((record for record in folders if same_folder(record, inspection, self._install_id)), None)
        if same is not None and same.ref.workspace_id != workspace_id:
            raise ConflictError("该文件夹已绑定到另一个工作区", details={
                "reason": "already_bound", "workspace_id": same.ref.workspace_id})
        self._policy.check_workspace(inspection.path, folders, ignore_workspace_id=workspace_id)
        entry = inspection.marker.entry_for(self._install_id) if inspection.marker else None
        if entry is not None and entry.workspace_id != workspace_id:
            async with self._read_uow_factory() as uow:
                other = await uow.workspace.get(entry.workspace_id)
            if other is not None and other.status is not WorkspaceStatus.DELETING:
                raise ConflictError("该文件夹的身份标记属于本机的另一个工作区", details={
                    "reason": "marker_other_workspace", "workspace_id": other.id, "workspace_name": other.name})

    async def _ensure_idle(self, workspace_id: str, uow: Optional[IUnitOfWork] = None) -> None:
        """改绑只在没有写入者时进行：有未释放的写入租约或活动运行则冲突，避免写入落在旧位置与新位置之间。"""
        if uow is None:
            async with self._read_uow_factory() as reader:
                return await self._ensure_idle(workspace_id, reader)
        lease = await uow.lease.get(workspace_id)
        if lease is not None:
            raise ConflictError("工作区文件夹正在被写入或尚未确认写入已结束，暂不能改绑文件夹", details=lease_details(lease))
        for session_id in await uow.session.ids_by_workspace(workspace_id):
            active = await uow.run.get_active(session_id)
            if active is not None:
                raise ConflictError("工作区有正在进行的运行，请先停止后再改绑文件夹",
                                    details={"session_id": session_id, "run_id": active.id})

    # ---- 修改与归档 ----

    async def _update(self, workspace_id: str, version: int, **values) -> WorkspaceView:
        async with self._uow_factory() as uow:
            current = await uow.workspace.get(workspace_id)
            if current is None or current.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            updated = await uow.workspace.update(workspace_id, version, **values)
        if updated is None:
            raise ConflictError("工作区已被修改，请刷新后重试", resource_version=current.version)
        return await self.get(workspace_id, refresh=False)

    async def rename(self, workspace_id: str, name: str, version: int) -> WorkspaceView:
        return await self._update(workspace_id, version, name=valid_name(name))

    async def set_local_execution(self, workspace_id: str, enabled: bool, version: int) -> WorkspaceView:
        """工作区本机执行开关：写入 settings.local_execution_enabled。"""
        from app.domain.models.execution_settings import with_workspace_execution
        view = await self.get(workspace_id, refresh=False)
        settings = with_workspace_execution(view.workspace.settings, enabled)
        return await self._update(workspace_id, version, settings=settings)

    async def set_auto_memory(self, workspace_id: str, enabled: bool, version: int) -> WorkspaceView:
        """工作区自动记忆提炼开关：写入 settings.auto_memory_enabled；关闭只影响之后登记的提炼任务。"""
        from app.domain.models.memory_settings import with_auto_memory
        view = await self.get(workspace_id, refresh=False)
        return await self._update(workspace_id, version, settings=with_auto_memory(view.workspace.settings, enabled))

    async def archive(self, workspace_id: str, version: int) -> WorkspaceView:
        return await self._update(workspace_id, version, status=WorkspaceStatus.ARCHIVED)

    async def unarchive(self, workspace_id: str, version: int) -> WorkspaceView:
        return await self._update(workspace_id, version, status=WorkspaceStatus.ACTIVE)

    # ---- 删除 ----

    async def _wait_for_writers(self, workspace_id: str) -> None:
        """等文件夹里的写入者静止：被取消的运行收尾、进行中的上传与撤销都会释放租约。
        取得租约会核对工作区状态，所以标记删除之后不会再有新的写入者，回收备份时不会留下孤立记录。
        停止后未能确认静止的租约（blocked）不再等待；期限内仍有写入者则冲突，不强行删除。"""
        deadline = time.monotonic() + self._quiesce_seconds
        while True:
            async with self._read_uow_factory() as uow:
                lease = await uow.lease.get(workspace_id)
            if lease is None or lease.state is LeaseState.BLOCKED:
                return
            if time.monotonic() >= deadline:
                raise ConflictError("工作区文件夹仍有写入者，请稍后重试", details=lease_details(lease))
            await asyncio.sleep(0.1)

    async def delete(self, workspace_id: str) -> BackgroundJob:
        """标记删除、删除其会话并登记后台清理；文件夹与其中的用户文件不会被删除。"""
        async with self._read_uow_factory() as uow:
            session_ids = await uow.session.ids_by_workspace(workspace_id)
            exists = await uow.workspace.get(workspace_id)
        if exists is None or exists.status is WorkspaceStatus.DELETING:
            raise NotFoundError("工作区不存在")
        if self._task_cls is not None:
            for session_id in session_ids:
                async with self._read_uow_factory() as uow:
                    active = await uow.run.get_active(session_id)
                task = self._task_cls.get(active.id) if active is not None else None
                if task is not None and not task.done:
                    task.cancel()
        await self._wait_for_writers(workspace_id)
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            lease = await uow.lease.get(workspace_id)
            if lease is not None and lease.state is not LeaseState.BLOCKED:
                raise ConflictError("工作区文件夹仍有写入者，请稍后重试", details=lease_details(lease))
            folder = await uow.root.workspace_folder(workspace_id)
            objects, directories = [], []
            for session_id in await uow.session.ids_by_workspace(workspace_id):
                objects += [file.key for file in await uow.file.list_by_session(session_id) if file.key]
                registered = await uow.root.session_workdir(session_id)
                if registered:
                    directories.append(registered[1])
                await uow.session.delete_by_id(session_id)
            objects += await uow.change.delete_workspace(workspace_id)  # 写前备份属于工作区，随工作区回收
            await wipe_workspace_memory(uow, workspace_id)  # 记忆、摘要与检索文档立即不可见，后台任务再兜底清理
            await uow.lease.delete_workspace(workspace_id)
            marker = {"install_id": self._install_id, "workspace_id": workspace_id}
            if folder is not None:
                marker.update(path=folder.location, dev=folder.dev, ino=folder.ino)
                await uow.root.remove(folder.ref.root_id)
            await uow.workspace.update(workspace_id, workspace.version, status=WorkspaceStatus.DELETING)
            job = BackgroundJob(
                operation_id=str(uuid.uuid4()), kind=OperationKind.WORKSPACE_DELETE, retry_supported=True,
                scope=OperationScope(kind=OperationScopeKind.WORKSPACE, workspace_id=workspace_id),
                payload=dict(objects=objects, directories=directories, workspace_id=workspace_id, marker=marker),
                progress=OperationProgress(completed=0, total=len(objects) + len(directories)))
            job = await self._jobs.submit(uow, job)
        self._jobs.wake()
        return job


def workspace_delete_handler(folders: FolderAccess, uow_factory: Callable[[], IUnitOfWork], remove_object,
                             remove_directory):
    """删除工作区的后台任务：回收会话文件与备份对象，尽力移除本机的文件夹标记条目，最后删除工作区记录。
    不触碰文件夹里的用户文件；任务可重复执行，已不存在的条目算作完成。"""
    reclaim = cleanup_handler(remove_object, remove_directory)

    async def handle(context: JobContext) -> dict:
        result = await reclaim(context)
        payload = context.job.payload
        marker = payload.get("marker") or {}
        removed = False
        if marker.get("path") and marker.get("dev") is not None:
            removed = await folders.remove_marker(marker["path"], marker["dev"], marker["ino"],
                                                  marker["install_id"], marker["workspace_id"])
        async with uow_factory() as uow:
            await wipe_workspace_memory(uow, payload["workspace_id"])
            await uow.workspace.remove(payload["workspace_id"])
        return {**result, "marker_removed": removed}
    return handle
