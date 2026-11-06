"""受理记录与持久输入。

accepted_requests 按请求身份保存内容摘要与受理结果；run_inputs 保存已受理的用户消息、目标运行与消费状态，
消息正文在 events 中按 message_seq 读取。受理与消费都和对应事件在同一写事务提交。
"""
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now


class AcceptedRequestModel(Base):
    __tablename__ = "accepted_requests"

    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)


class RunInputModel(Base):
    __tablename__ = "run_inputs"
    __table_args__ = (
        Index("ix_run_inputs_run", "run_id", "status", "id"),
        Index("ix_run_inputs_session", "session_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str] = mapped_column(String(128), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    message_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    consumed_seq: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
