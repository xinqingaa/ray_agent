"""可访问根登记：每个会话一个会话工作目录根；每个工作区一个文件夹根，登记规范路径、文件系统身份与可用状态。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now


class RootModel(Base):
    __tablename__ = "roots"
    __table_args__ = (
        Index("uq_roots_session_workdir", "session_id", unique=True, sqlite_where=text("kind = 'session_workdir'")),
        Index("uq_roots_workspace_folder", "workspace_id", unique=True,
              sqlite_where=text("kind = 'workspace_folder'")),
        Index("ix_roots_identity", "fs_dev", "fs_ino"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    session_id: Mapped[Optional[str]] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"),
                                                      nullable=True)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    location: Mapped[str] = mapped_column(Text, nullable=False)  # 会话工作目录为相对数据根的位置，工作区文件夹为规范绝对路径
    fs_dev: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # 工作区文件夹登记的文件系统身份
    fs_ino: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    folder_status: Mapped[str] = mapped_column(String(16), nullable=False, default="available")
    marker_writable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    checked_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
