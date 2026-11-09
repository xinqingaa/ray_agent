"""工作区文件夹的写入租约：取得、重入、释放，以及停止收尾与启动扫描。

租约持久记录在业务库，每个工作区至多一个。取得与释放各是一个短写事务，不在事务里做文件 IO。被占用时立即返回
冲突（带占用者与原因），不排队等待。释放核对租约身份：持有者拿着取得时的租约身份释放，运行收尾只释放该运行的
租约，所以迟到的结果不会释放后来取得的租约。写入者未确认静止时租约转为 blocked，保留到用户重试收尾成功。
"""
import logging
import uuid
from typing import Awaitable, Callable, Optional

from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorCode
from app.domain.models.workspace import WorkspaceStatus
from app.domain.models.write_lease import LeaseState, WriteLease, WriterKind
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_scope import WriteOwner

logger = logging.getLogger(__name__)

ConfirmQuiescent = Callable[[str], Awaitable[bool]]


def lease_details(lease: WriteLease) -> dict:
    """冲突错误里给界面与模型看的占用信息。"""
    return {"lease": {
        "id": lease.id, "state": lease.state.value, "writer_kind": lease.writer_kind.value,
        "owner_session_id": lease.owner_session_id, "owner_run_id": lease.owner_run_id,
        "operation": lease.operation, "reason": lease.reason,
        "acquired_at": int(lease.acquired_at.timestamp() * 1000)}}


def _occupied(lease: WriteLease) -> WorkspaceFileError:
    who = f"会话 {lease.owner_session_id}" if lease.owner_session_id else "文件夹的其他写入"
    if lease.state in (LeaseState.SETTLING, LeaseState.BLOCKED):
        hint = "正在停止，尚未确认写入已结束" if lease.state is LeaseState.SETTLING \
            else "停止后未能确认写入已结束，需要重试收尾"
    else:
        hint = "正在写入，稍后重试"
    reason = f"（{lease.reason}）" if lease.reason else ""
    return WorkspaceFileError(ErrorCode.CONFLICT, f"工作区文件夹被{who}占用{reason}：{hint}", details=lease_details(lease))


class WriteLeaseService:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
                 instance_id: str, confirm_quiescent: Optional[ConfirmQuiescent] = None) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._instance_id = instance_id
        self._confirm = confirm_quiescent
        self._live: dict[str, int] = {}  # 本进程内仍持有租约的写入者数；与业务库里的租约行对照即知是否残留

    async def acquire(self, workspace_id: str, owner: WriteOwner, reason: str,
                      kind: WriterKind = WriterKind.CORE_TOOL) -> str:
        """取得租约并返回租约身份；同一持有者重入，其他持有者立即得到冲突。"""
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise WorkspaceFileError(ErrorCode.NOT_FOUND, "工作区不存在或正在删除")
            if workspace.status is WorkspaceStatus.ARCHIVED:
                raise WorkspaceFileError(ErrorCode.FORBIDDEN, "工作区已归档，不能执行写入")
            current = await uow.lease.get(workspace_id)
            if current is None:
                lease = WriteLease(id=uuid.uuid4().hex, workspace_id=workspace_id, owner_session_id=owner.session_id,
                                   owner_run_id=owner.run_id, operation=owner.operation, writer_kind=kind,
                                   instance_id=self._instance_id, reason=reason)
                await uow.lease.add(lease)
                self._live[lease.id] = self._live.get(lease.id, 0) + 1
                return lease.id
            reentrant = (current.owned_by(owner.session_id, owner.run_id, owner.operation)
                         and current.instance_id == self._instance_id
                         and current.state in (LeaseState.PREPARING, LeaseState.HELD))
            if not reentrant:
                raise _occupied(current)
            if kind is WriterKind.PROCESS and current.writer_kind is not WriterKind.PROCESS:
                await uow.lease.set_writer_kind(current.id, kind)
            await uow.lease.set_holds(current.id, current.holds + 1)
            self._live[current.id] = self._live.get(current.id, 0) + 1
            return current.id

    async def mark(self, lease_id: str, state: LeaseState) -> None:
        async with self._uow_factory() as uow:
            current = await uow.lease.get_by_id(lease_id)
            if current is not None and current.state in (LeaseState.PREPARING, LeaseState.HELD):
                await uow.lease.set_state(lease_id, state)

    async def release(self, lease_id: str) -> bool:
        """持有者按租约身份释放一次；最后一次释放才删除。租约已被收尾或替换时不做任何事。"""
        remaining = self._live.get(lease_id, 0) - 1
        if remaining > 0:
            self._live[lease_id] = remaining
        else:
            self._live.pop(lease_id, None)
        try:
            async with self._uow_factory() as uow:
                current = await uow.lease.get_by_id(lease_id)
                if current is None:
                    return False
                if current.holds > 1:
                    await uow.lease.set_holds(lease_id, current.holds - 1)
                    return False
                return await uow.lease.delete(lease_id)
        except Exception:
            # 写入已经完成，不能因释放失败改变它的结果；残留的租约本实例已无对应写入者，可由 retry_settle 清除
            logger.exception("释放写入租约失败，租约残留待收尾 lease=%s", lease_id)
            return False

    async def get(self, workspace_id: str) -> Optional[WriteLease]:
        async with self._read_uow_factory() as uow:
            return await uow.lease.get(workspace_id)

    # ---- 停止收尾 ----

    async def begin_settle(self, run_id: str) -> None:
        """运行被停止：它持有的租约转为 settling，等待执行协程确认退出。"""
        async with self._uow_factory() as uow:
            for lease in await uow.lease.list():
                if lease.owner_run_id == run_id:
                    await uow.lease.set_state(lease.id, LeaseState.SETTLING, "停止中，等待写入结束")

    async def finish_settle(self, run_id: str, confirmed: bool) -> list[WriteLease]:
        """确认写入者已退出则释放该运行的租约；期限内无法确认则转 blocked，保留到重试收尾成功。"""
        async with self._uow_factory() as uow:
            if confirmed:
                released = await uow.lease.delete_for_run(run_id)
                for lease in released:
                    self._live.pop(lease.id, None)
                return released
            blocked = []
            for lease in await uow.lease.list():
                if lease.owner_run_id == run_id:
                    await uow.lease.set_state(lease.id, LeaseState.BLOCKED, "停止后未能确认写入已结束")
                    blocked.append(lease)
            return blocked

    async def retry_settle(self, workspace_id: str) -> Optional[WriteLease]:
        """重试收尾：执行协程已退出（或这次取消后确认退出）才释放；否则保持 blocked 并返回冲突。"""
        lease = await self.get(workspace_id)
        if lease is None:
            return None
        own = lease.instance_id == self._instance_id
        in_process = lease.writer_kind is WriterKind.CORE_TOOL
        live = own and self._live.get(lease.id, 0) > 0
        if lease.state in (LeaseState.PREPARING, LeaseState.HELD):
            if not own or live or not in_process:
                raise WorkspaceFileError(ErrorCode.CONFLICT, "租约正在被正常写入使用，不需要重试收尾",
                                         details=lease_details(lease))
            quiet = True  # 本实例没有对应的内存写入者：释放时出错残留的租约
        elif not own:
            quiet = in_process
        elif lease.owner_run_id is None or (in_process and not live):
            quiet = True  # 上传与撤销在各自的请求里完成；核心内文件写入者没有内存持有即已静止
        else:
            quiet = self._confirm is not None and await self._confirm(lease.owner_run_id)
        if not quiet:
            hint = "仍无法确认写入者已结束，租约继续保持阻止状态"
            if not in_process:
                hint += "；确认相关进程已经结束后，可使用“确认旧进程已结束”释放占用"
            raise WorkspaceFileError(ErrorCode.CONFLICT, hint, details=lease_details(lease))
        async with self._uow_factory() as uow:
            await uow.lease.delete(lease.id)
        return lease

    async def confirm_release(self, workspace_id: str, lease_id: str) -> None:
        """用户显式确认未知旧进程已结束；按所见身份释放，不触及后来取得的租约。"""
        async with self._uow_factory() as uow:
            lease = await uow.lease.get(workspace_id)
            if lease is None:
                return
            if lease.id != lease_id or lease.state is not LeaseState.BLOCKED or lease.writer_kind is not WriterKind.PROCESS:
                raise WorkspaceFileError(ErrorCode.CONFLICT, '写入占用已变化，请重新读取', details=lease_details(lease))
            run = await uow.run.get(lease.owner_run_id) if lease.owner_run_id else None
            if run is not None and not run.status.terminal:
                raise WorkspaceFileError(ErrorCode.CONFLICT, '请先停止所属运行，再确认旧进程已结束', details=lease_details(lease))
            await uow.lease.delete(lease.id)
            self._live.pop(lease.id, None)

    # ---- 启动扫描 ----

    async def scan_startup(self) -> list[WriteLease]:
        """旧核心实例遗留的租约：核心进程内的文件写入者随进程结束已静止，释放并记录；
        其他写入者类型（外部进程）核心无法凭记录断定已静止，转 blocked 保留，由对应写入者的收尾处理。"""
        released = []
        async with self._uow_factory() as uow:
            for lease in await uow.lease.foreign(self._instance_id):
                if lease.writer_kind is WriterKind.CORE_TOOL:
                    await uow.lease.delete(lease.id)
                    released.append(lease)
                else:
                    await uow.lease.set_state(lease.id, LeaseState.BLOCKED, "核心重启后未能确认外部写入者已结束")
        for lease in released:
            logger.info("启动扫描释放旧实例的写入租约 workspace=%s session=%s run=%s state=%s", lease.workspace_id,
                        lease.owner_session_id, lease.owner_run_id, lease.state.value)
        return released
