"""记忆条目、来源、变更、抑制与提炼任务的 SQLite 实现。"""
from __future__ import annotations  # 仓库有名为 list 的方法，类体内的 list[...] 注解不能在定义时求值

from typing import Optional, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.workspace_memory import (
    ExtractionCommitStatus, ExtractionJob,
    MemoryChange,
    MemoryEntry,
    MemorySource,
    MemoryStatus,
    MemorySuppression,
)
from app.domain.repositories.memory_repository import MemoryRepository
from app.infrastructure.models.workspace_memory import (
    ExtractionJobModel,
    MemoryChangeModel,
    MemoryEntryModel,
    MemorySourceModel,
    MemorySuppressionModel,
)


class DBMemoryRepository(MemoryRepository):
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, entry: MemoryEntry) -> None:
        self.db_session.add(MemoryEntryModel.from_domain(entry))
        await self.db_session.flush()

    async def get(self, memory_id: str) -> Optional[MemoryEntry]:
        model = await self.db_session.get(MemoryEntryModel, memory_id, populate_existing=True)
        return model.to_domain() if model else None

    async def save(self, entry: MemoryEntry) -> None:
        model = await self.db_session.get(MemoryEntryModel, entry.id)
        if model is None:
            await self.add(entry)
            return
        model.content = entry.content
        model.memory_type = entry.memory_type.value
        model.origin = entry.origin.value
        model.certainty = entry.certainty.value
        model.status = entry.status.value
        model.pinned = entry.pinned
        model.version = entry.version
        model.supersedes_id = entry.supersedes_id
        model.supersedes_version = entry.supersedes_version
        model.updated_at = entry.updated_at
        model.last_used_at = entry.last_used_at
        await self.db_session.flush()

    async def list(
            self, workspace_id: str, *, statuses: Optional[Sequence[MemoryStatus]] = None,
            pinned_only: bool = False,
    ) -> list[MemoryEntry]:
        stmt = select(MemoryEntryModel).where(MemoryEntryModel.workspace_id == workspace_id)
        if statuses:
            stmt = stmt.where(MemoryEntryModel.status.in_([s.value for s in statuses]))
        if pinned_only:
            stmt = stmt.where(MemoryEntryModel.pinned.is_(True))
        rows = (await self.db_session.execute(
            stmt.order_by(MemoryEntryModel.pinned.desc(), MemoryEntryModel.updated_at.desc())
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def add_source(self, source: MemorySource) -> None:
        self.db_session.add(MemorySourceModel.from_domain(source))
        await self.db_session.flush()

    async def list_sources(self, memory_id: str) -> list[MemorySource]:
        rows = (await self.db_session.execute(
            select(MemorySourceModel).where(MemorySourceModel.memory_id == memory_id)
            .order_by(MemorySourceModel.created_at)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def add_change(self, change: MemoryChange) -> None:
        self.db_session.add(MemoryChangeModel.from_domain(change))
        await self.db_session.flush()

    async def list_changes(self, memory_id: str) -> list[MemoryChange]:
        rows = (await self.db_session.execute(
            select(MemoryChangeModel).where(MemoryChangeModel.memory_id == memory_id)
            .order_by(MemoryChangeModel.to_version)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def add_suppression(self, item: MemorySuppression) -> None:
        self.db_session.add(MemorySuppressionModel.from_domain(item))
        await self.db_session.flush()

    async def is_suppressed(
            self, workspace_id: str, session_id: str, source_seq_end: int, fingerprint: str,
    ) -> bool:
        row = (await self.db_session.execute(
            select(MemorySuppressionModel.id).where(
                MemorySuppressionModel.workspace_id == workspace_id,
                MemorySuppressionModel.session_id == session_id,
                MemorySuppressionModel.source_seq_end == source_seq_end,
                MemorySuppressionModel.content_fingerprint == fingerprint,
            ).limit(1)
        )).scalar_one_or_none()
        return row is not None

    async def clear_suppressions(self, workspace_id: str, session_id: str, fingerprint: str) -> None:
        await self.db_session.execute(
            delete(MemorySuppressionModel).where(
                MemorySuppressionModel.workspace_id == workspace_id,
                MemorySuppressionModel.session_id == session_id,
                MemorySuppressionModel.content_fingerprint == fingerprint,
            ))

    async def add_extraction(self, job: ExtractionJob) -> None:
        self.db_session.add(ExtractionJobModel.from_domain(job))
        await self.db_session.flush()

    async def get_extraction(self, extraction_id: str) -> Optional[ExtractionJob]:
        model = await self.db_session.get(ExtractionJobModel, extraction_id)
        return model.to_domain() if model else None

    async def get_extraction_by_operation(self, operation_id: str) -> Optional[ExtractionJob]:
        row = (await self.db_session.execute(
            select(ExtractionJobModel).where(ExtractionJobModel.operation_id == operation_id)
        )).scalar_one_or_none()
        return row.to_domain() if row else None

    async def save_extraction(self, job: ExtractionJob) -> None:
        model = await self.db_session.get(ExtractionJobModel, job.id)
        if model is None:
            await self.add_extraction(job)
            return
        model.result_identity = job.result_identity
        model.commit_status = job.commit_status.value
        model.updated_at = job.updated_at
        await self.db_session.flush()

    async def next_extraction_generation(self, session_id: str) -> int:
        value = (await self.db_session.execute(
            select(func.coalesce(func.max(ExtractionJobModel.generation), 0))
            .where(ExtractionJobModel.session_id == session_id)
        )).scalar_one()
        return int(value) + 1

    async def invalidate_extractions(self, workspace_id: str, *, session_id: Optional[str] = None) -> list[str]:
        stmt = select(ExtractionJobModel).where(
            ExtractionJobModel.workspace_id == workspace_id,
            ExtractionJobModel.commit_status == ExtractionCommitStatus.PENDING.value)
        if session_id is not None:
            stmt = stmt.where(ExtractionJobModel.session_id == session_id)
        rows = (await self.db_session.execute(stmt)).scalars().all()
        from app.domain.models.clock import utc_now
        for row in rows:
            row.commit_status = ExtractionCommitStatus.REJECTED.value
            row.updated_at = utc_now()
        await self.db_session.flush()
        return [row.operation_id for row in rows]

    async def delete_workspace(self, workspace_id: str) -> None:
        for model in (
            MemorySuppressionModel, MemoryChangeModel, MemorySourceModel,
            MemoryEntryModel, ExtractionJobModel,
        ):
            await self.db_session.execute(delete(model).where(model.workspace_id == workspace_id))
