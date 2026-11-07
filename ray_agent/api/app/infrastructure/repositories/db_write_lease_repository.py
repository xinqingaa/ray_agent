"""写入租约的 SQLite 实现。"""
from typing import List, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.clock import utc_now
from app.domain.models.write_lease import LeaseState, WriteLease
from app.domain.repositories.write_lease_repository import WriteLeaseRepository
from app.infrastructure.models import WriteLeaseModel


class DBWriteLeaseRepository(WriteLeaseRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def get(self, workspace_id: str) -> Optional[WriteLease]:
        model = (await self.db_session.execute(select(WriteLeaseModel).where(
            WriteLeaseModel.workspace_id == workspace_id))).scalar_one_or_none()
        return model.to_domain() if model is not None else None

    async def get_by_id(self, lease_id: str) -> Optional[WriteLease]:
        model = await self.db_session.get(WriteLeaseModel, lease_id, populate_existing=True)
        return model.to_domain() if model is not None else None

    async def list(self) -> List[WriteLease]:
        rows = (await self.db_session.execute(select(WriteLeaseModel).order_by(WriteLeaseModel.acquired_at))).scalars()
        return [row.to_domain() for row in rows]

    async def add(self, lease: WriteLease) -> None:
        self.db_session.add(WriteLeaseModel.from_domain(lease))
        await self.db_session.flush()

    async def set_holds(self, lease_id: str, holds: int) -> None:
        await self.db_session.execute(update(WriteLeaseModel).where(WriteLeaseModel.id == lease_id).values(
            holds=holds, updated_at=utc_now()).execution_options(synchronize_session=False))

    async def set_state(self, lease_id: str, state: LeaseState, reason: Optional[str] = None) -> bool:
        values = {"state": state.value, "updated_at": utc_now()}
        if reason is not None:
            values["reason"] = reason
        result = await self.db_session.execute(update(WriteLeaseModel).where(WriteLeaseModel.id == lease_id)
                                               .values(**values).execution_options(synchronize_session=False))
        return result.rowcount > 0

    async def delete(self, lease_id: str) -> bool:
        result = await self.db_session.execute(delete(WriteLeaseModel).where(WriteLeaseModel.id == lease_id)
                                               .execution_options(synchronize_session=False))
        return result.rowcount > 0

    async def delete_for_run(self, run_id: str) -> List[WriteLease]:
        rows = (await self.db_session.execute(select(WriteLeaseModel).where(
            WriteLeaseModel.owner_run_id == run_id))).scalars().all()
        leases = [row.to_domain() for row in rows]
        if leases:
            await self.db_session.execute(delete(WriteLeaseModel).where(WriteLeaseModel.owner_run_id == run_id)
                                          .execution_options(synchronize_session=False))
        return leases

    async def foreign(self, instance_id: str) -> List[WriteLease]:
        rows = (await self.db_session.execute(select(WriteLeaseModel).where(
            WriteLeaseModel.instance_id != instance_id))).scalars()
        return [row.to_domain() for row in rows]

    async def delete_workspace(self, workspace_id: str) -> None:
        await self.db_session.execute(delete(WriteLeaseModel).where(WriteLeaseModel.workspace_id == workspace_id)
                                      .execution_options(synchronize_session=False))

    async def delete_all(self) -> None:
        await self.db_session.execute(delete(WriteLeaseModel).execution_options(synchronize_session=False))
