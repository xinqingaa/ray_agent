#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话事件 ORM 模型：主键 (session_id, seq)。"""
from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import TypeAdapter
from sqlalchemy import ForeignKey, Index, Integer, PrimaryKeyConstraint, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from ...domain.models.event import BaseEvent, Event

_EVENT_ADAPTER = TypeAdapter(Event)
_COLUMN_FIELDS = {"seq", "run_id", "type", "created_at"}


class EventModel(Base):
    __tablename__ = "events"
    __table_args__ = (
        PrimaryKeyConstraint("session_id", "seq", name="pk_events_session_seq"),
        Index("ix_events_run_id", "run_id"),
    )

    session_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("sessions.id", ondelete="CASCADE", name="fk_events_session_id"), nullable=False,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(
        String(255), ForeignKey("runs.id", ondelete="CASCADE", name="fk_events_run_id"), nullable=True,
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(precision=3), nullable=False)

    @staticmethod
    def payload_of(event: BaseEvent) -> Dict[str, Any]:
        return event.model_dump(mode="json", exclude=_COLUMN_FIELDS)

    def to_domain(self) -> Event:
        event = _EVENT_ADAPTER.validate_python({**self.payload, "type": self.type, "created_at": self.created_at})
        event.seq = self.seq
        event.run_id = self.run_id
        return event
