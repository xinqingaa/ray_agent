"""持久输入与受理记录的 SQLite 实现。"""
from typing import Collection, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.clock import utc_now
from app.domain.models.run import ACTIVE_RUN_STATUSES
from app.domain.models.run_input import AcceptedRequest, RunInput, RunInputStatus
from app.domain.repositories.input_repository import AcceptedRequestRepository, RunInputRepository
from app.infrastructure.models import AcceptedRequestModel, RunInputModel, RunModel

_INPUT_FIELDS = ("id", "session_id", "run_id", "message_seq", "request_id", "status", "consumed_seq", "created_at",
                 "consumed_at")


def _input(record: RunInputModel) -> RunInput:
    return RunInput.model_validate({field: getattr(record, field) for field in _INPUT_FIELDS})


class DBRunInputRepository(RunInputRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, run_input: RunInput) -> int:
        record = RunInputModel(session_id=run_input.session_id, run_id=run_input.run_id,
                               request_id=run_input.request_id, message_seq=run_input.message_seq,
                               status=run_input.status.value, created_at=run_input.created_at)
        self.db_session.add(record)
        await self.db_session.flush()
        run_input.id = record.id
        return record.id

    async def get(self, input_id: int) -> Optional[RunInput]:
        record = await self.db_session.get(RunInputModel, input_id, populate_existing=True)
        return _input(record) if record else None

    async def pending(self, run_id: str, exclude: Collection[int] = ()) -> List[RunInput]:
        stmt = select(RunInputModel).where(RunInputModel.run_id == run_id,
                                           RunInputModel.status == RunInputStatus.PENDING.value)
        if exclude:
            stmt = stmt.where(RunInputModel.id.not_in(list(exclude)))
        records = (await self.db_session.execute(
            stmt.order_by(RunInputModel.id).execution_options(populate_existing=True))).scalars().all()
        return [_input(record) for record in records]

    async def consume(self, input_ids: Collection[int], consumed_seq: int) -> int:
        if not input_ids:
            return 0
        result = await self.db_session.execute(
            update(RunInputModel)
            .where(RunInputModel.id.in_(list(input_ids)), RunInputModel.status == RunInputStatus.PENDING.value)
            .values(status=RunInputStatus.CONSUMED.value, consumed_seq=consumed_seq, consumed_at=utc_now())
            .execution_options(synchronize_session=False))
        return result.rowcount

    async def unconsumed(self, session_id: str) -> List[RunInput]:
        stmt = (
            select(RunInputModel)
            .join(RunModel, RunModel.id == RunInputModel.run_id)
            .where(RunInputModel.session_id == session_id, RunInputModel.status == RunInputStatus.PENDING.value,
                   RunModel.status.not_in([status.value for status in ACTIVE_RUN_STATUSES]))
            .order_by(RunInputModel.id)
        )
        return [_input(record) for record in (await self.db_session.execute(stmt)).scalars().all()]

    async def reassign(self, input_id: int, run_id: str) -> None:
        await self.db_session.execute(
            update(RunInputModel).where(RunInputModel.id == input_id).values(run_id=run_id)
            .execution_options(synchronize_session=False))


class DBAcceptedRequestRepository(AcceptedRequestRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def get(self, request_id: str) -> Optional[AcceptedRequest]:
        record = await self.db_session.get(AcceptedRequestModel, request_id)
        if record is None:
            return None
        return AcceptedRequest(request_id=record.request_id, session_id=record.session_id, kind=record.kind,
                               digest=record.digest, result=record.result, created_at=record.created_at)

    async def add(self, request: AcceptedRequest) -> None:
        self.db_session.add(AcceptedRequestModel(**request.model_dump()))
        await self.db_session.flush()
