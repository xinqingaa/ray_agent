"""组件安装协调：业务库受理、代次隔离、受管 worker 与可恢复发布。"""
from __future__ import annotations

import asyncio
import uuid

from app.application.errors.exceptions import AppException, ConflictError
from app.application.services.background_jobs import JobCancelled, JobSuperseded
from app.domain.external.process_executor import ProcessOwner, ProcessSpec, ProcessState
from app.domain.external.runtime_components import ComponentState
from app.domain.models.background_job import BackgroundJob
from app.domain.models.identity import RootedPath
from app.domain.models.operation import OperationKind, OperationScope, OperationScopeKind, OperationStatus
from core.paths import RESOURCE_ROOT
from core.workers import worker_command

WORKER_TIMEOUT_SECONDS = 600
WORKER_POLL_SECONDS = 0.25


class ComponentService:
    def __init__(self, components, uow_factory, read_uow_factory, jobs, executor_factory, on_available=None):
        self.components, self.uow_factory, self.read_uow_factory = components, uow_factory, read_uow_factory
        self.jobs, self.executor_factory, self.on_available = jobs, executor_factory, on_available

    def entry(self, component_id):
        from app.infrastructure.external.components.local_components import ComponentError
        try:
            return self.components.entry(component_id)
        except ComponentError as error:
            raise AppException(error.code, str(error)) from error

    async def latest(self, component_id, uow):
        return await uow.job.latest(OperationKind.COMPONENT_INSTALL, object_version=component_id)

    async def list(self):
        rows = []
        async with self.read_uow_factory() as uow:
            for entry in self.components.manifest.values():
                status = await self.components.status(entry.component_id)
                job = await self.latest(entry.component_id, uow)
                if job and status.state is not ComponentState.AVAILABLE:
                    status.state = {
                        OperationStatus.QUEUED: ComponentState.FETCHING,
                        OperationStatus.RUNNING: ComponentState.VERIFYING if job.phase == '校验中' else ComponentState.FETCHING,
                        OperationStatus.SUCCEEDED: ComponentState.NOT_INSTALLED,
                        OperationStatus.FAILED: ComponentState.FAILED,
                        OperationStatus.CANCELLED: ComponentState.CANCELLED,
                    }[job.status]
                rows.append(dict(**status.model_dump(), target_version=entry.version,
                                          update_available=not self.components.target_is_current(entry.component_id),
                                          platform=entry.platform, size=entry.size,
                                          operation=job))
        return rows

    async def list_components(self):
        from app.domain.external.runtime_components import ComponentStatus
        return [ComponentStatus(**{**row, 'operation_id': row['operation'].operation_id if row['operation'] else None,
                                   'error': (row['operation'].error if row['operation'] else None) or row.get('error')})
                for row in await self.list()]

    async def status(self, component_id):
        self.entry(component_id)
        return next(row for row in await self.list_components() if row.component_id == component_id)

    async def install(self, component_id, request_id):
        return (await self.accept(component_id, request_id)).operation_id

    async def cancel(self, operation_id):
        from app.application.errors.exceptions import NotFoundError
        job = await self.jobs.get(operation_id)
        if job is None or job.kind is not OperationKind.COMPONENT_INSTALL:
            raise NotFoundError('组件安装操作不存在')
        await self.jobs.cancel(operation_id)

    async def locate(self, component_id):
        return await self.components.locate(component_id)

    async def accept(self, component_id, request_id):
        entry = self.entry(component_id)
        async with self.uow_factory() as uow:
            existing = await uow.job.by_request(request_id)
            if existing:
                if existing.kind is not OperationKind.COMPONENT_INSTALL or existing.payload != {
                    'component_id': component_id, 'version': entry.version, 'sha256': entry.sha256,
                }:
                    raise ConflictError('请求身份已用于不同的操作')
                return existing
            latest = await self.latest(component_id, uow)
            if latest and not latest.status.terminal:
                raise ConflictError('组件正在安装', details={'operation_id': latest.operation_id})
            job = await uow.job.add(BackgroundJob(
                operation_id=str(uuid.uuid4()), kind=OperationKind.COMPONENT_INSTALL,
                scope=OperationScope(kind=OperationScopeKind.APP), request_id=request_id,
                idempotency_key=request_id, object_version=component_id, retry_supported=True,
                payload={'component_id': component_id, 'version': entry.version, 'sha256': entry.sha256}))
        self.jobs.wake()
        return job

    async def process(self, context):
        job = context.job
        component_id = job.payload['component_id']
        entry = self.entry(component_id)
        if entry.version != job.payload['version'] or entry.sha256 != job.payload['sha256']:
            raise RuntimeError('组件清单已变化，请重新发起安装')
        async with self.read_uow_factory() as uow:
            latest = await self.latest(component_id, uow)
        if latest.operation_id != job.operation_id:
            raise RuntimeError('已有较新的安装操作，请从组件设置读取当前操作')
        # 发布后、任务结束写回前崩溃时，重启可从原子收据收敛。
        if self.components.target_is_current(component_id):
            if self.on_available:
                await self.on_available(component_id)
            return {'component_id': component_id, 'version': entry.version}
        token = f'{job.operation_id}-{job.generation}'
        target = self.components.staging(component_id, token)
        for action, phase in [('fetch', '获取中'), ('verify', '校验中')]:
            await context.check_cancel()
            await context.progress(phase=phase)
            await self._worker(context, action, component_id, target)
        # 写事务排斥取消／重试／新受理；检查之后到原子替换之间没有 await。
        async with self.uow_factory() as uow:
            current = await uow.job.get(job.operation_id)
            latest = await self.latest(component_id, uow)
            if current.generation != job.generation or current.owner_instance != job.owner_instance \
                    or current.status is not OperationStatus.RUNNING or latest.operation_id != job.operation_id:
                raise JobSuperseded(job.operation_id)
            if current.cancel_requested_at:
                raise JobCancelled(job.operation_id)
            self.components.publish(component_id, token)
        if self.on_available:
            await self.on_available(component_id)
        return {'component_id': component_id, 'version': entry.version}

    async def _worker(self, context, action, component_id, target):
        executor = await self.executor_factory()
        executor.register_root('component-worker', str(RESOURCE_ROOT))
        started = await executor.start(ProcessSpec(
            argv=worker_command('component', action, component_id, str(target)),
            cwd=RootedPath(root_id='component-worker'),
            owner=ProcessOwner(operation_id=context.job.operation_id)))
        try:
            async with asyncio.timeout(WORKER_TIMEOUT_SECONDS):
                while True:
                    await context.check_cancel()
                    status = await executor.wait(started.process_id, WORKER_POLL_SECONDS)
                    if status.state is not ProcessState.RUNNING:
                        if status.state is not ProcessState.EXITED or status.exit_code != 0:
                            output = await executor.read_output(started.process_id)
                            raise RuntimeError(output.text[-2000:] or '组件 worker 失败')
                        break
        except TimeoutError as error:
            raise RuntimeError('组件获取或校验超时，可以重试') from error
        finally:
            # 包括取消、核心退出、轮询异常；supervisor 在核心崩溃时自行回收。
            await asyncio.shield(executor.kill_tree(started.process_id))
