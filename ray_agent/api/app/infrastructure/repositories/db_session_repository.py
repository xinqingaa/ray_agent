#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话仓库。记忆与文件清单是会话行上的 JSON 文本列；修改在写事务里读改写，写事务串行，不会丢失并发更新。"""
from datetime import datetime
from typing import List, Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.domain.models.file import File
from app.domain.models.memory import Memory
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.session_repository import SessionRepository
from app.infrastructure.models import SessionModel
from app.infrastructure.repositories.catalog_hints import note


class DBSessionRepository(SessionRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def _record(self, session_id: str) -> SessionModel:
        record = await self.db_session.get(SessionModel, session_id, populate_existing=True)
        if record is None:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")
        return record

    async def _update(self, session_id: str, *, catalog: bool = True, **values) -> None:
        result = await self.db_session.execute(
            update(SessionModel).where(SessionModel.id == session_id).values(**values)
            .execution_options(synchronize_session=False))
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")
        if catalog:
            note(self.db_session, "session", session_id)

    async def save(self, session: Session) -> None:
        record = await self.db_session.get(SessionModel, session.id)
        if record is None:
            self.db_session.add(SessionModel.from_domain(session))
        else:
            record.update_from_domain(session)
        await self.db_session.flush()
        note(self.db_session, "session", session.id)

    async def get_all(self) -> List[Session]:
        stmt = select(SessionModel).order_by(SessionModel.latest_message_at.desc())
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars().all()]

    async def get_by_id(self, session_id: str) -> Optional[Session]:
        record = await self.db_session.get(SessionModel, session_id, populate_existing=True)
        return record.to_domain() if record is not None else None

    lock = get_by_id

    async def delete_by_id(self, session_id: str) -> None:
        await self.db_session.execute(delete(SessionModel).where(SessionModel.id == session_id))
        note(self.db_session, "session", session_id)

    async def update_title(self, session_id: str, title: str) -> None:
        await self._update(session_id, title=title)

    async def set_title(self, session_id: str, title: str, source: str, expected_source: Optional[str] = None) -> bool:
        stmt = update(SessionModel).where(SessionModel.id == session_id)
        if expected_source is not None:
            stmt = stmt.where(SessionModel.title_source == expected_source)
        result = await self.db_session.execute(
            stmt.values(title=title, title_source=source).execution_options(synchronize_session=False))
        if result.rowcount > 0:
            note(self.db_session, "session", session_id)
        return result.rowcount > 0

    async def update_participation(self, session_id: str, participate: bool) -> None:
        await self._update(session_id, participate_in_memory=bool(participate))

    async def ids_by_workspace(self, workspace_id: str) -> List[str]:
        return list((await self.db_session.execute(
            select(SessionModel.id).where(SessionModel.workspace_id == workspace_id))).scalars())

    async def page(self, *, offset: int = 0, limit: int = 50,
                   workspace_id: Optional[str] = None, independent: bool = False) -> tuple[List[Session], int]:
        scope = [SessionModel.workspace_id == workspace_id] if workspace_id else \
            [SessionModel.workspace_id.is_(None)] if independent else []
        total = (await self.db_session.execute(
            select(func.count()).select_from(SessionModel).where(*scope))).scalar_one()
        stmt = (
            select(SessionModel).where(*scope)
            .options(defer(SessionModel.memories), defer(SessionModel.files))
            .order_by(SessionModel.latest_message_at.desc().nullslast(), SessionModel.created_at.desc(),
                      SessionModel.id)
            .offset(offset).limit(limit)
        )
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain(with_content=False) for record in records], total

    async def update_model(self, session_id: str, model_id: str, reasoning: str) -> None:
        await self._update(session_id, model_id=model_id, reasoning=reasoning)

    async def update_sampling(self, session_id: str, context_window: int, max_tokens: int, temperature: float) -> None:
        await self._update(session_id, context_window=context_window, max_tokens=max_tokens, temperature=temperature)

    async def update_latest_message(self, session_id: str, message: str, timestamp: datetime) -> None:
        await self._update(session_id, latest_message=message, latest_message_at=timestamp)

    async def add_file(self, session_id: str, file: File) -> None:
        record = await self._record(session_id)
        record.files = [*(record.files or []), file.model_dump(mode="json")]
        await self.db_session.flush()

    async def remove_file(self, session_id: str, file_id: str) -> None:
        record = await self._record(session_id)
        kept = [item for item in record.files or [] if item.get("id") != file_id]
        if len(kept) != len(record.files or []):
            record.files = kept
            await self.db_session.flush()

    async def get_file_by_path(self, session_id: str, filepath: str) -> Optional[File]:
        files = (await self.db_session.execute(
            select(SessionModel.files).where(SessionModel.id == session_id))).scalar_one_or_none()
        for item in reversed(files or []):
            if item.get("filepath", "") == filepath:
                return File(**item)
        return None

    async def update_status(self, session_id: str, status: SessionStatus) -> None:
        await self._update(session_id, status=status.value)

    async def update_unread_message_count(self, session_id: str, count: int) -> None:
        await self._update(session_id, unread_message_count=count)

    async def increment_unread_message_count(self, session_id: str) -> None:
        await self._update(session_id, unread_message_count=SessionModel.unread_message_count + 1)

    async def decrement_unread_message_count(self, session_id: str) -> None:
        await self._update(session_id, unread_message_count=func.max(SessionModel.unread_message_count - 1, 0))

    async def save_memory(self, session_id: str, agent_name: str, memory: Memory) -> None:
        record = await self._record(session_id)
        record.memories = {**(record.memories or {}), agent_name: memory.model_dump(mode="json")}
        await self.db_session.flush()

    async def get_memory(self, session_id: str, agent_name: str) -> Memory:
        memories = (await self.db_session.execute(
            select(SessionModel.memories).where(SessionModel.id == session_id))).scalar_one_or_none()
        data = (memories or {}).get(agent_name)
        return Memory(**data) if data else Memory(messages=[])

    async def summary_material(self, session_id: str) -> dict:
        from app.domain.services.summary_material import bound_material
        from app.infrastructure.models import EventModel, RunModel
        role = func.json_extract(EventModel.payload, "$.role")
        messages = select(EventModel).where(EventModel.session_id == session_id, EventModel.type == "message")
        users = messages.where(role == "user")
        first = (await self.db_session.execute(users.order_by(EventModel.seq).limit(1))).scalar_one_or_none()
        recent = (await self.db_session.execute(users.order_by(EventModel.seq.desc()).limit(12))).scalars().all()
        latest = (
            select(func.max(EventModel.seq))
            .join(RunModel, RunModel.id == EventModel.run_id)
            .where(EventModel.session_id == session_id, EventModel.type == "message", role == "assistant",
                   RunModel.status == "completed")
            .group_by(EventModel.run_id)
        )
        finals = (await self.db_session.execute(
            select(EventModel).where(EventModel.session_id == session_id, EventModel.seq.in_(latest))
            .order_by(EventModel.seq.desc()).limit(12))).scalars().all()
        runs = (await self.db_session.execute(
            select(RunModel).where(RunModel.session_id == session_id,
                                   RunModel.status.in_(["completed", "failed", "cancelled", "interrupted"]))
            .order_by(RunModel.started_at.desc()).limit(12))).scalars().all()
        material = bound_material(first, recent, finals, runs)
        cutoff = (await self.db_session.execute(
            select(func.max(EventModel.seq)).where(EventModel.session_id == session_id,
                                                   EventModel.type.in_(["message", "run"])))).scalar()
        material["source_seq"] = max(material["source_seq"], cutoff or 0)
        return material
