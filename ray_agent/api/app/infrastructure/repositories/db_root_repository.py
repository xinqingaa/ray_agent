"""可访问根的 SQLite 实现。"""
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.identity import RootKind, RootRef
from app.domain.repositories.root_repository import RootRepository
from app.infrastructure.models import RootModel


class DBRootRepository(RootRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, root: RootRef, location: str) -> None:
        self.db_session.add(RootModel(id=root.root_id, kind=root.kind.value, session_id=root.session_id,
                                      workspace_id=root.workspace_id, location=location))
        await self.db_session.flush()

    async def session_workdir(self, session_id: str) -> Optional[Tuple[RootRef, str]]:
        record = (await self.db_session.execute(select(RootModel).where(
            RootModel.session_id == session_id, RootModel.kind == RootKind.SESSION_WORKDIR.value))).scalar_one_or_none()
        if record is None:
            return None
        return RootRef(root_id=record.id, kind=RootKind(record.kind), session_id=record.session_id,
                       workspace_id=record.workspace_id), record.location
