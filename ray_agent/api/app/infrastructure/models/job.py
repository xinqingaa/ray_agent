"""持久后台任务：状态沿长操作契约，结果写回按代次与实例所有者核对。"""
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, NullableJSON, UTCDateTime
from ...domain.models.clock import utc_now


class BackgroundJobModel(Base):
    __tablename__ = "background_jobs"
    __table_args__ = (
        Index("ix_background_jobs_status", "status", "created_at"),
        Index("uq_background_jobs_key", "kind", "idempotency_key", unique=True,
              sqlite_where=text("idempotency_key IS NOT NULL")),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)  # 会话删除后清理仍需执行，不设外键
    object_version: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    owner_instance: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cancel_requested_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    phase: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    progress_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(NullableJSON, nullable=True)
    error: Mapped[Optional[Dict[str, Any]]] = mapped_column(NullableJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    started_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
