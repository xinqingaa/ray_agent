"""每笔外部模型请求及其固化的计价结果。"""
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime


class UsageModel(Base):
    __tablename__ = "model_usage"
    __table_args__ = (
        Index("ix_model_usage_time", "started_at"),
        Index("ix_model_usage_provider", "provider", "started_at"),
        Index("ix_model_usage_session", "session_id"),
        Index("ix_model_usage_run", "run_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"))
    run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"))
    workspace_id: Mapped[str | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"))
    purpose: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    failed: Mapped[bool]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    total_tokens: Mapped[int | None]
    cached_tokens: Mapped[int | None]
    cache_write_tokens: Mapped[int | None]
    reasoning_tokens: Mapped[int | None]
    audio_duration_ms: Mapped[int | None]
    cost_nano_usd: Mapped[int | None]
    cost_nano_cny: Mapped[int | None]
    price_version: Mapped[str | None] = mapped_column(String(64))
    price_period: Mapped[str | None] = mapped_column(String(24))
