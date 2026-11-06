"""应用配置：按分区一行（模型、Agent、工具策略、MCP、A2A），version 随每次保存递增。"""
from datetime import datetime
from typing import Any, Dict

from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now


class AppConfigModel(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    data: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now, onupdate=utc_now)
