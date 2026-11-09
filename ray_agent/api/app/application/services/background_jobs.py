"""持久后台任务的通用执行框架。

任务在调用方的写事务里登记，提交后唤醒执行器；执行器领取任务时记录实例所有者，进度与结果写回都核对代次与所有者，
重试或重启接管后迟到的写回被拒绝。取消请求先记录，由处理函数在安全点确认；取消请求不是终态。
核心启动时，上一实例遗留的运行中任务按类型重新排队或标为失败，不通用重放全部工作。
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional, Set

from app.domain.models.background_job import BackgroundJob
from app.domain.models.error import ErrorCode, ErrorInfo
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind, \
    OperationStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)


class JobSuperseded(Exception):
    """任务已被重试、接管或结束：本次执行的写回不再有效。"""


class JobCancelled(Exception):
    """处理函数在安全点确认了取消请求。"""


class JobContext:
    def __init__(self, runner: "BackgroundJobRunner", job: BackgroundJob) -> None:
        self._runner = runner
        self.job = job

    async def progress(self, *, phase: Optional[str] = None, completed: Optional[int] = None,
                       total: Optional[int] = None) -> None:
        async with self._runner.uow_factory() as uow:
            accepted = await uow.job.progress(self.job.operation_id, self.job.generation, self._runner.instance_id,
                                              phase=phase, completed=completed, total=total)
        if not accepted:
            raise JobSuperseded(self.job.operation_id)

    async def check_cancel(self) -> None:
        """安全点：已请求取消时抛出 JobCancelled。"""
        async with self._runner.read_uow_factory() as uow:
            current = await uow.job.get(self.job.operation_id)
        if current is None or current.generation != self.job.generation \
                or current.owner_instance != self._runner.instance_id or current.status is not OperationStatus.RUNNING:
            raise JobSuperseded(self.job.operation_id)
        if current.cancel_requested_at is not None:
            raise JobCancelled(self.job.operation_id)


Handler = Callable[[JobContext], Awaitable[Optional[dict]]]


@dataclass
class _Registration:
    handler: Handler
    requeue_on_restart: bool


def cleanup_job(*, objects: List[str], directories: List[str], session_id: Optional[str] = None,
                extra: Optional[dict] = None) -> BackgroundJob:
    """回收内容对象与会话工作目录；只按登记清单删除，可重复执行。"""
    scope = OperationScope(kind=OperationScopeKind.SESSION, session_id=session_id) if session_id \
        else OperationScope(kind=OperationScopeKind.APP)
    return BackgroundJob(operation_id=str(uuid.uuid4()), kind=OperationKind.DATA_CLEANUP, scope=scope,
                         retry_supported=True, payload=dict(objects=objects, directories=directories, **(extra or {})),
                         progress=OperationProgress(completed=0, total=len(objects) + len(directories)))


class BackgroundJobRunner:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], instance_id: str, *, concurrency: int = 2,
                 poll_seconds: float = 30.0, read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None) -> None:
        self.uow_factory = uow_factory
        self.read_uow_factory = read_uow_factory or uow_factory
        self.instance_id = instance_id
        self._concurrency = concurrency
        self._poll_seconds = poll_seconds
        self._handlers: Dict[OperationKind, _Registration] = {}
        self._wake: Optional[asyncio.Event] = None
        self._loop_task: Optional[asyncio.Task] = None
        self._running: Set[asyncio.Task] = set()

    def register(self, kind: OperationKind, handler: Handler, *, requeue_on_restart: bool) -> None:
        self._handlers[kind] = _Registration(handler, requeue_on_restart)

    async def submit(self, uow: IUnitOfWork, job: BackgroundJob) -> BackgroundJob:
        """在调用方的写事务里登记；提交成功后由调用方 wake()。同类型同幂等键返回已有任务。"""
        return await uow.job.add(job)

    def wake(self) -> None:
        if self._wake is not None:
            self._wake.set()

    async def recover(self) -> List[BackgroundJob]:
        """启动扫描：上一实例遗留的 running 任务按类型重新排队，或标为可重试的失败。"""
        async with self.uow_factory() as uow:
            running = [job for job in await uow.job.running() if job.owner_instance != self.instance_id]
            for job in running:
                registration = self._handlers.get(job.kind)
                if job.cancel_requested_at is not None:
                    await uow.job.finish(job.operation_id, job.generation, job.owner_instance, OperationStatus.CANCELLED)
                elif registration is not None and registration.requeue_on_restart:
                    await uow.job.requeue(job.operation_id)
                else:
                    await uow.job.finish(job.operation_id, job.generation, job.owner_instance, OperationStatus.FAILED,
                                         error=ErrorInfo.of(ErrorCode.UNAVAILABLE, "核心重启中断了任务，可以重试",
                                                            retryable=job.retry_supported))
        return running

    def start(self) -> None:
        if self._loop_task is None:
            self._wake = asyncio.Event()
            self._loop_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        tasks = [task for task in (self._loop_task, *self._running) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._loop_task = None
        self._running.clear()

    async def _loop(self) -> None:
        while True:
            self._wake.clear()
            try:
                while len(self._running) < self._concurrency:
                    async with self.uow_factory() as uow:
                        job = await uow.job.claim(self.instance_id, list(self._handlers))
                    if job is None:
                        break
                    task = asyncio.create_task(self.run_job(job))
                    self._running.add(task)
                    task.add_done_callback(self._finished)
            except Exception:
                logger.exception("领取后台任务失败，稍后重试")
            try:
                await asyncio.wait_for(self._wake.wait(), self._poll_seconds)
            except asyncio.TimeoutError:
                pass

    def _finished(self, task: asyncio.Task) -> None:
        self._running.discard(task)
        self.wake()

    async def run_job(self, job: BackgroundJob) -> None:
        context = JobContext(self, job)
        status, result, error = OperationStatus.SUCCEEDED, None, None
        try:
            result = await self._handlers[job.kind].handler(context)
        except JobSuperseded:
            logger.info(f"后台任务[{job.operation_id}]已被接管或结束，丢弃本次结果")
            return
        except JobCancelled:
            status = OperationStatus.CANCELLED
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(f"后台任务[{job.operation_id}]失败")
            status, error = OperationStatus.FAILED, ErrorInfo.of(
                ErrorCode.INTERNAL_ERROR, str(exc) or type(exc).__name__, retryable=job.retry_supported)
        async with self.uow_factory() as uow:
            accepted = await uow.job.finish(job.operation_id, job.generation, self.instance_id, status,
                                            result=result, error=error)
        if not accepted:
            logger.info(f"后台任务[{job.operation_id}]结果写回被拒绝：代次或所有者已变化")

    async def get(self, job_id: str) -> Optional[BackgroundJob]:
        async with self.read_uow_factory() as uow:
            return await uow.job.get(job_id)

    async def cancel(self, job_id: str) -> Optional[BackgroundJob]:
        async with self.uow_factory() as uow:
            return await uow.job.request_cancel(job_id)

    async def retry(self, job_id: str) -> Optional[BackgroundJob]:
        async with self.uow_factory() as uow:
            job = await uow.job.retry(job_id)
        self.wake()
        return job


def cleanup_handler(remove_object: Callable[[str], None], remove_directory: Callable[[str], None]) -> Handler:
    """按清单删除内容对象与会话工作目录；已不存在的条目算作完成，失败保留进度供重试接着做。"""
    async def handle(context: JobContext) -> dict:
        payload = context.job.payload
        items = [("objects", key) for key in payload.get("objects", [])] + \
                [("directories", location) for location in payload.get("directories", [])]
        start = context.job.progress.completed if context.job.progress else 0
        await context.progress(phase="回收会话文件", total=len(items))
        for index, (kind, value) in enumerate(items):
            if index < start:
                continue
            await asyncio.to_thread(remove_object if kind == "objects" else remove_directory, value)
            await context.progress(completed=index + 1)
        return dict(objects=len(payload.get("objects", [])), directories=len(payload.get("directories", [])))
    return handle


_runner: Optional[BackgroundJobRunner] = None


def set_job_runner(runner: Optional[BackgroundJobRunner]) -> None:
    global _runner
    _runner = runner


def get_job_runner() -> BackgroundJobRunner:
    if _runner is None:
        raise RuntimeError("后台任务执行器未启动")
    return _runner
