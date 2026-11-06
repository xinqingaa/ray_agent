"""可访问根登记：每个会话一个会话工作目录根；工作区文件夹根由文件夹工作区加入。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now


class RootModel(Base):
    __tablename__ = "roots"
    __table_args__ = (
        Index("uq_roots_session_workdir", "session_id", unique=True, sqlite_where=text("kind = 'session_workdir'")),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    session_id: Mapped[Optional[str]] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"),
                                                      nullable=True)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    location: Mapped[str] = mapped_column(Text, nullable=False)  # 会话工作目录为相对数据根的位置
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
