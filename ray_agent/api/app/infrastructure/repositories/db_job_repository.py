"""后台任务的 SQLite 实现：写回条件同时包含代次、所有者与运行状态。"""
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorInfo
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationStatus
from app.domain.repositories.job_repository import BackgroundJobRepository
from app.infrastructure.models import BackgroundJobModel

RETRY_SUPPORTED = frozenset({OperationKind.DATA_CLEANUP, OperationKind.WORKSPACE_DELETE})


def _job(record: BackgroundJobModel) -> BackgroundJob:
    progress = None
    if record.progress_total is not None or record.progress_completed:
        progress = OperationProgress(completed=record.progress_completed, total=record.progress_total)
    return BackgroundJob(
        operation_id=record.id, kind=OperationKind(record.kind),
        scope=OperationScope(kind=record.scope_kind, workspace_id=record.workspace_id, session_id=record.session_id),
        generation=record.generation, status=OperationStatus(record.status), phase=record.phase, progress=progress,
        request_id=record.request_id, cancel_requested_at=record.cancel_requested_at, created_at=record.created_at,
        updated_at=record.updated_at, finished_at=record.finished_at, result=record.result,
        error=ErrorInfo.model_validate(record.error) if record.error else None,
        retry_supported=OperationKind(record.kind) in RETRY_SUPPORTED, payload=record.payload or {},
        owner_instance=record.owner_instance, object_version=record.object_version,
        idempotency_key=record.idempotency_key, started_at=record.started_at,
    )


class DBBackgroundJobRepository(BackgroundJobRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def _record(self, job_id: str) -> Optional[BackgroundJobModel]:
        return await self.db_session.get(BackgroundJobModel, job_id, populate_existing=True)

    async def add(self, job: BackgroundJob) -> BackgroundJob:
        if job.idempotency_key is not None:
            existing = (await self.db_session.execute(select(BackgroundJobModel).where(
                BackgroundJobModel.kind == job.kind.value,
                BackgroundJobModel.idempotency_key == job.idempotency_key))).scalar_one_or_none()
            if existing is not None:
                return _job(existing)
        record = BackgroundJobModel(
            id=job.operation_id, kind=job.kind.value, scope_kind=job.scope.kind.value,
            workspace_id=job.scope.workspace_id, session_id=job.scope.session_id, object_version=job.object_version,
            idempotency_key=job.idempotency_key, request_id=job.request_id, status=job.status.value,
            generation=job.generation, phase=job.phase, payload=job.payload,
            progress_completed=job.progress.completed if job.progress else 0,
            progress_total=job.progress.total if job.progress else None,
            created_at=job.created_at, updated_at=job.updated_at,
        )
        self.db_session.add(record)
        await self.db_session.flush()
        return _job(record)

    async def get(self, job_id: str) -> Optional[BackgroundJob]:
        record = await self._record(job_id)
        return _job(record) if record else None

    async def latest(self, kind: OperationKind, scope_kind: Optional[str] = None,
                     session_id: Optional[str] = None) -> Optional[BackgroundJob]:
        stmt = select(BackgroundJobModel).where(BackgroundJobModel.kind == kind.value)
        if scope_kind is not None:
            stmt = stmt.where(BackgroundJobModel.scope_kind == scope_kind)
        if session_id is not None:
            stmt = stmt.where(BackgroundJobModel.session_id == session_id)
        record = (await self.db_session.execute(
            stmt.order_by(BackgroundJobModel.created_at.desc()).limit(1))).scalar_one_or_none()
        return _job(record) if record else None

    async def claim(self, owner: str, kinds: Sequence[OperationKind]) -> Optional[BackgroundJob]:
        if not kinds:
            return None
        record = (await self.db_session.execute(
            select(BackgroundJobModel)
            .where(BackgroundJobModel.status == OperationStatus.QUEUED.value,
                   BackgroundJobModel.kind.in_([kind.value for kind in kinds]))
            .order_by(BackgroundJobModel.created_at, BackgroundJobModel.id).limit(1)
            .execution_options(populate_existing=True))).scalar_one_or_none()
        if record is None:
            return None
        now = utc_now()
        record.status, record.owner_instance, record.started_at, record.updated_at = (
            OperationStatus.RUNNING.value, owner, now, now)
        await self.db_session.flush()
        return _job(record)

    async def _guarded(self, job_id: str, generation: int, owner: str, **values) -> bool:
        result = await self.db_session.execute(
            update(BackgroundJobModel)
            .where(BackgroundJobModel.id == job_id, BackgroundJobModel.generation == generation,
                   BackgroundJobModel.owner_instance == owner,
                   BackgroundJobModel.status == OperationStatus.RUNNING.value)
            .values(updated_at=utc_now(), **values)
            .execution_options(synchronize_session=False))
        return result.rowcount == 1

    async def progress(self, job_id: str, generation: int, owner: str, *, phase: Optional[str] = None,
                       completed: Optional[int] = None, total: Optional[int] = None) -> bool:
        values: Dict[str, Any] = {}
        if phase is not None:
            values["phase"] = phase
        if completed is not None:
            values["progress_completed"] = completed
        if total is not None:
            values["progress_total"] = total
        return await self._guarded(job_id, generation, owner, **values)

    async def finish(self, job_id: str, generation: int, owner: str, status: OperationStatus, *,
                     result: Optional[Dict[str, Any]] = None, error: Optional[ErrorInfo] = None) -> bool:
        return await self._guarded(job_id, generation, owner, status=status.value, result=result,
                                   error=error.model_dump(mode="json") if error else None, finished_at=utc_now())

    async def request_cancel(self, job_id: str) -> Optional[BackgroundJob]:
        record = await self._record(job_id)
        if record is None:
            return None
        now = utc_now()
        if record.status == OperationStatus.QUEUED.value:
            record.status, record.finished_at = OperationStatus.CANCELLED.value, now
            record.cancel_requested_at = record.updated_at = now
        elif record.status == OperationStatus.RUNNING.value and record.cancel_requested_at is None:
            record.cancel_requested_at = record.updated_at = now
        await self.db_session.flush()
        return _job(record)

    async def retry(self, job_id: str) -> Optional[BackgroundJob]:
        record = await self._record(job_id)
        if record is None:
            return None
        if record.status in (OperationStatus.FAILED.value, OperationStatus.CANCELLED.value) \
                and OperationKind(record.kind) in RETRY_SUPPORTED:
            self._reset(record)
            await self.db_session.flush()
        return _job(record)

    @staticmethod
    def _reset(record: BackgroundJobModel) -> None:
        record.status = OperationStatus.QUEUED.value
        record.generation += 1
        record.owner_instance = record.cancel_requested_at = record.finished_at = None
        record.result = record.error = None
        record.updated_at = utc_now()

    async def running(self) -> List[BackgroundJob]:
        records = (await self.db_session.execute(select(BackgroundJobModel).where(
            BackgroundJobModel.status == OperationStatus.RUNNING.value)
            .execution_options(populate_existing=True))).scalars().all()
        return [_job(record) for record in records]

    async def requeue(self, job_id: str) -> None:
        record = await self._record(job_id)
        if record is not None and record.status == OperationStatus.RUNNING.value:
            self._reset(record)
            await self.db_session.flush()
