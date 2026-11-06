#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""运行 ORM 模型：每个会话至多一个活动运行，由条件唯一索引与写事务内的复核共同保证。"""
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.run import Run

ACTIVE_STATUS_SQL = "status IN ('running', 'waiting')"


class RunModel(Base):
    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_session", "session_id", "started_at"),
        Index("ix_runs_status", "status"),
        Index("uq_runs_active_session", "session_id", unique=True, sqlite_where=text(ACTIVE_STATUS_SQL)),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    turns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cached_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    config_snapshot: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    @classmethod
    def from_domain(cls, run: Run) -> "RunModel":
        data = run.model_dump(mode="python", exclude={"config_snapshot", "status", "mode"})
        return cls(**data, status=run.status.value, mode=run.mode.value,
                   config_snapshot=run.model_dump(mode="json")["config_snapshot"])

    def to_domain(self) -> Run:
        return Run.model_validate(self, from_attributes=True)
