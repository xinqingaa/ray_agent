#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话事件 ORM 模型：主键 (session_id, seq)，seq 取自会话行的 next_event_seq。"""
from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import TypeAdapter
from sqlalchemy import JSON, ForeignKey, Index, Integer, PrimaryKeyConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.event import BaseEvent, Event

_EVENT_ADAPTER = TypeAdapter(Event)
_COLUMN_FIELDS = {"seq", "run_id", "type", "created_at"}


class EventModel(Base):
    __tablename__ = "events"
    __table_args__ = (
        PrimaryKeyConstraint("session_id", "seq", name="pk_events"),
        Index("ix_events_run", "run_id"),
        Index("ix_events_session_type", "session_id", "type", "seq"),
    )

    session_id: Mapped[str] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(String(128), ForeignKey("runs.id", ondelete="CASCADE"), nullable=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    @staticmethod
    def payload_of(event: BaseEvent) -> Dict[str, Any]:
        return event.model_dump(mode="json", exclude=_COLUMN_FIELDS)

    def to_domain(self) -> Event:
        event = _EVENT_ADAPTER.validate_python({**self.payload, "type": self.type, "created_at": self.created_at})
        event.seq = self.seq
        event.run_id = self.run_id
        return event
