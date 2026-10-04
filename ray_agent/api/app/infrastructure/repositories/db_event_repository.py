#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""基于 PostgreSQL events 表的事件仓库。"""
import asyncio
import logging
import random
from typing import List, Optional, Sequence

from asyncpg.exceptions import UniqueViolationError
from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.event import BaseEvent, Event
from app.domain.repositories.event_repository import EventRepository
from app.infrastructure.models import EventModel

logger = logging.getLogger(__name__)

MAX_SEQ_ATTEMPTS = 50


def _is_seq_conflict(error: IntegrityError) -> bool:
    cause = getattr(error.orig, "__cause__", None)
    return isinstance(cause, UniqueViolationError) or "pk_events_session_seq" in str(error)


class DBEventRepository(EventRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, session_id: str, event: BaseEvent) -> int:
        next_seq = (
            select(func.coalesce(func.max(EventModel.seq), 0) + 1)
            .where(EventModel.session_id == session_id)
            .scalar_subquery()
        )
        stmt = insert(EventModel).from_select(
            ["session_id", "seq", "run_id", "type", "payload", "created_at"],
            select(
                literal(session_id),
                next_seq,
                literal(event.run_id),
                literal(event.type),
                literal(EventModel.payload_of(event), EventModel.payload.type),
                literal(event.created_at, EventModel.created_at.type),
            ),
        ).returning(EventModel.seq)
        for attempt in range(1, MAX_SEQ_ATTEMPTS + 1):
            try:
                # 保存点：主键冲突只回滚这一次插入，外层事务里的其他写入保留
                async with self.db_session.begin_nested():
                    seq = (await self.db_session.execute(stmt)).scalar_one()
                event.seq = seq
                return seq
            except IntegrityError as e:
                if not _is_seq_conflict(e) or attempt == MAX_SEQ_ATTEMPTS:
                    raise
                logger.debug(f"会话[{session_id}] 事件 seq 冲突，第 {attempt} 次重试")
                await asyncio.sleep(random.uniform(0, 0.005 * attempt))
        raise RuntimeError("unreachable")

    async def list(
            self,
            session_id: str,
            after_seq: int = 0,
            limit: Optional[int] = None,
            types: Optional[Sequence[str]] = None,
            run_id: Optional[str] = None,
    ) -> List[Event]:
        stmt = (
            select(EventModel)
            .where(EventModel.session_id == session_id, EventModel.seq > after_seq)
            .order_by(EventModel.seq)
        )
        if types:
            stmt = stmt.where(EventModel.type.in_(list(types)))
        if run_id is not None:
            stmt = stmt.where(EventModel.run_id == run_id)
        if limit is not None:
            stmt = stmt.limit(limit)
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records]

    async def first_user_message(self, session_id: str) -> Optional[Event]:
        stmt = select(EventModel).where(EventModel.session_id == session_id, EventModel.type == 'message',
            EventModel.payload['role'].astext == 'user').order_by(EventModel.seq).limit(1)
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def max_seq(self, session_id: str) -> int:
        stmt = select(func.coalesce(func.max(EventModel.seq), 0)).where(EventModel.session_id == session_id)
        return (await self.db_session.execute(stmt)).scalar_one()
