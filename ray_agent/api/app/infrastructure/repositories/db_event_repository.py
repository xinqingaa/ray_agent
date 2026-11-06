#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""事件仓库：seq 取自会话行的 next_event_seq，在同一写事务里分配并与事件同提交。"""
from typing import List, Optional, Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.event import BaseEvent, Event
from app.domain.repositories.event_repository import EventRepository
from app.infrastructure.models import EventModel, SessionModel


class DBEventRepository(EventRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, session_id: str, event: BaseEvent) -> int:
        allocated = await self.db_session.execute(
            update(SessionModel).where(SessionModel.id == session_id)
            .values(next_event_seq=SessionModel.next_event_seq + 1)
            .returning(SessionModel.next_event_seq)
        )
        following = allocated.scalar_one_or_none()
        if following is None:
            raise ValueError(f"会话[{session_id}]不存在，事件未写入")
        seq = following - 1
        self.db_session.add(EventModel(session_id=session_id, seq=seq, run_id=event.run_id, type=event.type,
                                       payload=EventModel.payload_of(event), created_at=event.created_at))
        await self.db_session.flush()
        event.seq = seq
        return seq

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

    async def get(self, session_id: str, seq: int) -> Optional[Event]:
        record = await self.db_session.get(EventModel, (session_id, seq))
        return record.to_domain() if record else None

    async def first_user_message(self, session_id: str) -> Optional[Event]:
        stmt = select(EventModel).where(
            EventModel.session_id == session_id, EventModel.type == "message",
            func.json_extract(EventModel.payload, "$.role") == "user",
        ).order_by(EventModel.seq).limit(1)
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def max_seq(self, session_id: str) -> int:
        stmt = select(func.coalesce(func.max(EventModel.seq), 0)).where(EventModel.session_id == session_id)
        return (await self.db_session.execute(stmt)).scalar_one()
