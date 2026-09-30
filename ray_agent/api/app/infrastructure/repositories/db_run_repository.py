#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""基于 PostgreSQL runs 表的运行仓库。"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.run import ACTIVE_RUN_STATUSES, Run, RunStatus
from app.domain.repositories.run_repository import ActiveRunExistsError, RunRepository
from app.infrastructure.models import RunModel, SessionModel

_ACTIVE_VALUES = [status.value for status in ACTIVE_RUN_STATUSES]


class DBRunRepository(RunRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def create(self, run: Run) -> None:
        try:
            async with self.db_session.begin_nested():
                self.db_session.add(RunModel.from_domain(run))
                await self.db_session.flush()
        except IntegrityError as e:
            if "uq_runs_active_session" in str(e):
                raise ActiveRunExistsError(f"会话[{run.session_id}]已有进行中的运行") from e
            raise

    async def get(self, run_id: str) -> Optional[Run]:
        record = await self.db_session.get(RunModel, run_id, populate_existing=True)
        return record.to_domain() if record else None

    async def lock(self, run_id: str) -> Optional[Run]:
        stmt = select(RunModel).where(RunModel.id == run_id).with_for_update().execution_options(
            populate_existing=True)
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def get_active(self, session_id: str) -> Optional[Run]:
        stmt = select(RunModel).where(RunModel.session_id == session_id, RunModel.status.in_(_ACTIVE_VALUES))
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def get_active_project(self, project_id: str, exclude_session: Optional[str] = None) -> Optional[Run]:
        stmt = select(RunModel).join(SessionModel, SessionModel.id == RunModel.session_id).where(SessionModel.project_id == project_id, RunModel.status.in_(_ACTIVE_VALUES))
        if exclude_session:
            stmt = stmt.where(RunModel.session_id != exclude_session)
        record = (await self.db_session.execute(stmt.order_by(RunModel.started_at).limit(1))).scalar_one_or_none()
        return record.to_domain() if record else None

    async def list_by_session(self, session_id: str) -> List[Run]:
        stmt = select(RunModel).where(RunModel.session_id == session_id).order_by(RunModel.started_at)
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars().all()]

    async def list_by_status(self, status: RunStatus) -> List[Run]:
        stmt = select(RunModel).where(RunModel.status == status.value).order_by(RunModel.started_at)
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars().all()]

    async def transition(
            self,
            run_id: str,
            status: RunStatus,
            reason: Optional[str] = None,
            ended_at: Optional[datetime] = None,
    ) -> Optional[Run]:
        stmt = (
            update(RunModel)
            .where(RunModel.id == run_id, RunModel.status.in_(_ACTIVE_VALUES))
            .values(status=status.value, reason=reason, ended_at=ended_at)
            .returning(RunModel)
            .execution_options(synchronize_session=False)
        )
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def add_counters(
            self,
            run_id: str,
            turns: int = 0,
            model_requests: int = 0,
            tool_calls: int = 0,
            prompt_tokens: int = 0,
            completion_tokens: int = 0,
            cached_tokens: Optional[int] = None,
    ) -> None:
        values: Dict[str, Any] = {
            "turns": RunModel.turns + turns,
            "model_requests": RunModel.model_requests + model_requests,
            "tool_calls": RunModel.tool_calls + tool_calls,
            "prompt_tokens": RunModel.prompt_tokens + prompt_tokens,
            "completion_tokens": RunModel.completion_tokens + completion_tokens,
        }
        if cached_tokens is not None:
            values["cached_tokens"] = func.coalesce(RunModel.cached_tokens, 0) + cached_tokens
        stmt = update(RunModel).where(RunModel.id == run_id).values(**values)
        await self.db_session.execute(stmt.execution_options(synchronize_session=False))

    async def save_snapshot(self, run_id: str, snapshot: Dict[str, Any]) -> None:
        stmt = update(RunModel).where(RunModel.id == run_id).values(config_snapshot=snapshot)
        await self.db_session.execute(stmt.execution_options(synchronize_session=False))
