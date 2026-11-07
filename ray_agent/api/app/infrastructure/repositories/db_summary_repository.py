"""会话摘要与运行背景清单的 SQLite 实现。"""
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.run_context import RunContextManifest
from app.domain.models.session_summary_record import SessionSummaryRecord
from app.domain.repositories.memory_repository import RunContextRepository, SummaryRepository
from app.infrastructure.models.session_summary import RunContextManifestModel, SessionSummaryModel


class DBSummaryRepository(SummaryRepository):
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def get(self, session_id: str) -> Optional[SessionSummaryRecord]:
        model = await self.db_session.get(SessionSummaryModel, session_id, populate_existing=True)
        return model.to_domain() if model else None

    async def save(self, record: SessionSummaryRecord) -> None:
        model = await self.db_session.get(SessionSummaryModel, record.session_id)
        if model is None:
            self.db_session.add(SessionSummaryModel.from_domain(record))
        else:
            model.workspace_id = record.workspace_id
            model.body = record.body
            model.source_seq = record.source_seq
            model.generation = record.generation
            model.model = record.model
            model.state = record.state.value
            model.updated_at = record.updated_at
        await self.db_session.flush()

    async def list_workspace(self, workspace_id: str, *, limit: int = 50) -> list[SessionSummaryRecord]:
        rows = (await self.db_session.execute(
            select(SessionSummaryModel)
            .where(SessionSummaryModel.workspace_id == workspace_id)
            .order_by(SessionSummaryModel.updated_at.desc()).limit(limit)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def delete(self, session_id: str) -> None:
        await self.db_session.execute(
            delete(SessionSummaryModel).where(SessionSummaryModel.session_id == session_id))

    async def delete_workspace(self, workspace_id: str) -> None:
        await self.db_session.execute(
            delete(SessionSummaryModel).where(SessionSummaryModel.workspace_id == workspace_id))


class DBRunContextRepository(RunContextRepository):
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def save(self, manifest: RunContextManifest) -> None:
        existing = await self.db_session.get(RunContextManifestModel, manifest.run_id)
        if existing is not None:
            await self.db_session.delete(existing)
            await self.db_session.flush()
        self.db_session.add(RunContextManifestModel.from_domain(manifest))
        await self.db_session.flush()

    async def get(self, run_id: str) -> Optional[RunContextManifest]:
        model = await self.db_session.get(RunContextManifestModel, run_id)
        return model.to_domain() if model else None

    async def get_for_session(self, session_id: str, *, limit: int = 20) -> list[RunContextManifest]:
        rows = (await self.db_session.execute(
            select(RunContextManifestModel)
            .where(RunContextManifestModel.session_id == session_id)
            .order_by(RunContextManifestModel.created_at.desc()).limit(limit)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def delete_workspace(self, workspace_id: str) -> None:
        await self.db_session.execute(
            delete(RunContextManifestModel).where(RunContextManifestModel.workspace_id == workspace_id))
