#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话 ORM 模型。next_event_seq 在写事务中分配并与事件同提交；记忆与已交付文件清单是 JSON 文本列。"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, JSON, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.session import Session

_JSON_FIELDS = {"memories", "files"}
_DOMAIN_FIELDS = {"id", "workspace_id", "participate_in_memory", "memory_access_version", "instruction_version", "title", "title_source",
                  "status", "model_id", "reasoning", "context_window", "max_tokens",
                  "temperature", "unread_message_count", "latest_message", "latest_message_at", "created_at",
                  "updated_at"}


class SessionModel(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_latest", "latest_message_at", "created_at"),
        Index("ix_sessions_workspace", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    participate_in_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    memory_access_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    instruction_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    title_source: Mapped[str] = mapped_column(String(16), nullable=False, default="placeholder")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    model_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    reasoning: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    context_window: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unread_message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latest_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    latest_message_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    next_event_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    memories: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    files: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now, onupdate=utc_now)

    @staticmethod
    def _values(session: Session, fields) -> Dict[str, Any]:
        values = {**session.model_dump(mode="python", include=fields),
                  **session.model_dump(mode="json", include=_JSON_FIELDS)}
        values["status"] = session.status.value
        return values

    @classmethod
    def from_domain(cls, session: Session) -> "SessionModel":
        return cls(**cls._values(session, _DOMAIN_FIELDS))

    def update_from_domain(self, session: Session) -> None:
        for field, value in self._values(session, _DOMAIN_FIELDS - {"id", "workspace_id", "created_at", "updated_at"}).items():
            setattr(self, field, value)

    def to_domain(self, *, with_content: bool = True) -> Session:
        data = {field: getattr(self, field) for field in _DOMAIN_FIELDS}
        if with_content:
            data.update(memories=self.memories or {}, files=self.files or [])
        return Session.model_validate(data)
