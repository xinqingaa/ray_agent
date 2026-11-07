"""清空业务数据：一个写事务固定范围并删除全部会话与文件记录，再由持久清理任务回收内容对象与会话工作目录。

同一个事务也移除全部工作区登记及其写前备份、变更记录与写入租约；回收任务再尽力移除各文件夹里本机的身份标记条目，
不删除任何文件夹或用户文件。有运行中或等待中的对话、正在压缩上下文、有文件夹正在被写入（含没有运行身份的上传与撤销）
或已有未完成的清空时拒绝受理；写入者取得租约时会核对工作区仍然存在，所以清空提交后不会再有写前备份落入已回收的范围；
失败的回收按同一清单重试，不扩大范围。
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.background_jobs import BackgroundJobRunner, cleanup_handler, cleanup_job
from app.application.services.context_operations import context_operation
from app.domain.models.background_job import BackgroundJob
from app.domain.models.operation import OperationKind, OperationScopeKind, OperationStatus
from app.domain.models.write_lease import LeaseState

RESET_NAME = "所有对话与附件"
RESET_CONFIRMATION = "清空所有数据"


class CleanupTask(BaseModel):
    id: str
    scope: str = "all"
    project_id: Optional[str] = None
    name: str = RESET_NAME
    state: str
    phase: str
    completed: int = 0
    total: int = 0
    error: Optional[str] = None
    counts: dict[str, int] = Field(default_factory=dict)
    session_ids: list[str] = Field(default_factory=list)
    project_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_job(cls, job: BackgroundJob) -> "CleanupTask":
        state = {OperationStatus.SUCCEEDED: "completed", OperationStatus.FAILED: "failed",
                 OperationStatus.CANCELLED: "failed"}.get(job.status, "running")
        return cls(id=job.operation_id, state=state, phase=job.phase or "等待回收",
                   completed=job.progress.completed if job.progress else 0,
                   total=(job.progress.total or 0) if job.progress else 0,
                   error=job.error.message if job.error else None, counts=job.payload.get("counts", {}),
                   session_ids=job.payload.get("session_ids", []), created_at=job.created_at, updated_at=job.updated_at)


class CleanupPreview(BaseModel):
    name: str
    counts: dict[str, int]
    blocked_reason: Optional[str] = None
    occupying_session_id: Optional[str] = None
    task: Optional[CleanupTask] = None


def _counts(sessions: int, files: int, workspaces: int = 0) -> dict[str, int]:
    return dict(projects=0, workspaces=workspaces, sessions=sessions, files=files, snapshots=0, bytes=0, memory=0)


def data_cleanup_handler(folders, remove_object, remove_directory):
    """清空业务数据的回收任务：按清单删除内容对象与会话工作目录，再尽力移除本机的文件夹标记条目；
    任务可重复执行，不触碰文件夹里的用户文件。"""
    reclaim = cleanup_handler(remove_object, remove_directory)

    async def handle(context) -> dict:
        result = await reclaim(context)
        removed = 0
        for marker in context.job.payload.get("markers", []):
            if await folders.remove_marker(marker["path"], marker["dev"], marker["ino"], marker["install_id"],
                                           marker["workspace_id"]):
                removed += 1
        return {**result, "markers_removed": removed}
    return handle


class DataService:
    def __init__(self, uow_factory, jobs: BackgroundJobRunner, install_id: str = "") -> None:
        self._uow_factory = uow_factory
        self._jobs = jobs
        self._install_id = install_id

    async def _latest(self, uow) -> Optional[BackgroundJob]:
        return await uow.job.latest(OperationKind.DATA_CLEANUP, scope_kind=OperationScopeKind.APP.value)

    async def _inspect(self, uow):
        sessions, total = await uow.session.page(offset=0, limit=1_000_000)
        files = await uow.file.list_all()
        workspaces = len(await uow.workspace.list())
        reason, occupying = None, None
        for session in sessions:
            if await uow.run.get_active(session.id) is not None:
                reason, occupying = "请先停止正在运行或等待处理的对话", session.id
                break
            if context_operation(session.id)["status"] != "idle":
                reason = "请等待上下文压缩结束"
                break
        if reason is None:
            for lease in await uow.lease.list():
                if lease.state in (LeaseState.PREPARING, LeaseState.HELD):
                    reason, occupying = "有工作区文件夹正在被写入，请稍后再试", lease.owner_session_id or None
                    break
        latest = await self._latest(uow)
        pending = latest if latest is not None and not latest.status.terminal else None
        if pending is not None:
            reason = "已有未完成的数据清理，请先完成或重试"
        return sessions, files, workspaces, reason, occupying, latest

    async def preview(self) -> CleanupPreview:
        async with self._uow_factory() as uow:
            sessions, files, workspaces, reason, occupying, latest = await self._inspect(uow)
        task = CleanupTask.from_job(latest) if latest is not None and latest.status != OperationStatus.SUCCEEDED else None
        return CleanupPreview(name=RESET_NAME, counts=_counts(len(sessions), len(files), workspaces),
                              blocked_reason=reason,
                              occupying_session_id=occupying, task=task)

    async def latest(self) -> Optional[CleanupTask]:
        async with self._uow_factory() as uow:
            job = await self._latest(uow)
        return CleanupTask.from_job(job) if job is not None else None

    async def get(self, job_id: str) -> CleanupTask:
        job = await self._jobs.get(job_id)
        if job is None or job.kind != OperationKind.DATA_CLEANUP:
            raise NotFoundError("清理任务不存在")
        return CleanupTask.from_job(job)

    async def start(self, confirmation: str) -> CleanupTask:
        if confirmation != RESET_CONFIRMATION:
            raise BadRequestError("确认文字不匹配，请重新确认")
        async with self._uow_factory() as uow:
            sessions, files, workspaces, reason, _, _ = await self._inspect(uow)
            if reason:
                raise ConflictError(reason)
            directories = []
            for session in sessions:
                registered = await uow.root.session_workdir(session.id)
                if registered is not None:
                    directories.append(registered[1])
                await uow.session.delete_by_id(session.id)
            await uow.file.delete_all()
            backups = await uow.change.delete_all()
            await uow.lease.delete_all()
            folders = {record.ref.workspace_id: record for record in await uow.root.workspace_folders()}
            markers = []
            for workspace in await uow.workspace.list():
                folder = folders.get(workspace.id)
                if folder is not None:
                    if folder.dev is not None:
                        markers.append(dict(path=folder.location, dev=folder.dev, ino=folder.ino,
                                            install_id=self._install_id, workspace_id=workspace.id))
                    await uow.root.remove(folder.ref.root_id)
                await uow.workspace.remove(workspace.id)
            job = await self._jobs.submit(uow, cleanup_job(
                objects=[file.key for file in files if file.key] + backups, directories=directories,
                extra=dict(counts=_counts(len(sessions), len(files), workspaces),
                           session_ids=[s.id for s in sessions], markers=markers)))
        self._jobs.wake()
        return CleanupTask.from_job(job)

    async def retry(self, job_id: str) -> CleanupTask:
        job = await self._jobs.retry(job_id)
        if job is None or job.kind != OperationKind.DATA_CLEANUP:
            raise NotFoundError("清理任务不存在")
        return CleanupTask.from_job(job)
