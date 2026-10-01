"""单进程项目文件协调：持久占用不随请求取消释放，先停旧写入者再收敛。"""
import asyncio
import logging
import uuid
from weakref import WeakKeyDictionary
from app.domain.models.project_operation import ProjectOperation
from app.domain.services.project_operations import finish
from app.domain.services.project_transactions import ProjectRunConflict

logger = logging.getLogger(__name__)
_states = WeakKeyDictionary()


def state():
    return _states.setdefault(asyncio.get_running_loop(), {'writers': {}, 'locks': {}})


def register_writer(project_id):
    if not project_id:
        return None
    token = uuid.uuid4().hex
    state()['writers'].setdefault(project_id, set()).add(token)
    return token


def retire_writer(project_id, token):
    if token:
        writers = state()['writers'].get(project_id, set())
        writers.discard(token)
        if not writers:
            state()['writers'].pop(project_id, None)


class ProjectFileCoordinator:
    def __init__(self, uow_factory, sandbox_cls):
        self.factory, self.sandbox_cls = uow_factory, sandbox_cls

    async def settle(self, project_id):
        lock = state()['locks'].setdefault(project_id, asyncio.Lock())
        async with lock:
            if state()['writers'].get(project_id):
                return False  # 耗时创建/复制尚未退出，不得提前停止并放行。
            async with self.factory() as uow:
                project = await uow.project.get(project_id, lock=True)
                if not project:
                    return False
                active = await uow.run.get_active_project(project_id)
                startup_check = bool(project.file_operation and project.file_operation.phase == 'startup_check')
                if active and not startup_check:
                    return False  # waiting 保持原容器。
                keep_id = None
                if active:
                    session = await uow.session.get_by_id(active.session_id)
                    keep_id = session.sandbox_id if session else None
                if project.file_operation and project.file_operation.kind != 'settling':
                    return False
                if not project.file_operation:
                    project.file_operation = ProjectOperation(kind='settling', phase='stopping_writers')
                    await uow.project.save(project)
                    await uow.project.audit(project.id, "file_operation", project.file_operation.model_dump(mode="json"))
                operation_id = project.file_operation.operation_id
            try:
                # 操作不能因请求取消而提前释放；SDK 线程完全退出后再核对。
                work = asyncio.create_task(
                    self.sandbox_cls.stop_other_project_writers(project_id, keep_id) if active
                    else self.sandbox_cls.stop_project_writers(project_id))
                try:
                    await asyncio.shield(work)
                except asyncio.CancelledError:
                    await work
                    raise
            except BaseException as exc:
                async with self.factory() as uow:
                    await finish(uow, project_id, operation_id, error=str(exc) or type(exc).__name__)
                if isinstance(exc, asyncio.CancelledError):
                    raise
                logger.exception('项目[%s]环境收尾失败', project_id)
                return False
            async with self.factory() as uow:
                return await finish(uow, project_id, operation_id)

    async def retry_settling(self, project_id):
        if not await self.settle(project_id):
            raise ProjectRunConflict('项目环境尚未静止，请等待旧写入者退出或核对 Docker 后重试')

    async def reconcile_startup(self):
        async with self.factory() as uow:
            projects = await uow.project.all()
        for project in projects:
            # waiting 的关联容器保留，只清理不属于它的旧容器。
            if hasattr(self.sandbox_cls, 'stop_other_project_writers'):
                async with self.factory() as uow:
                    current = await uow.project.get(project.id, lock=True)
                    active = await uow.run.get_active_project(project.id)
                    if active and not current.file_operation:
                        current.file_operation = ProjectOperation(kind='settling', phase='startup_check',
                            run_id=active.id, session_id=active.session_id)
                        await uow.project.save(current)
                        await uow.project.audit(project.id, 'file_operation', current.file_operation.model_dump(mode='json'))
            await self.settle(project.id)
