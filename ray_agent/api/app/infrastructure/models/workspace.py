"""文件夹工作区：名称、状态、绑定的文件夹根与并发修改版本。文件夹位置与身份登记在 roots 表。"""
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.workspace import Workspace, WorkspaceStatus


class WorkspaceModel(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    folder_root_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    instruction_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    settings: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, workspace: Workspace) -> "WorkspaceModel":
        return cls(**{**workspace.model_dump(mode="python"), "status": workspace.status.value})

    def to_domain(self) -> Workspace:
        return Workspace(
            id=self.id, name=self.name, status=WorkspaceStatus(self.status),
            folder_root_id=self.folder_root_id, version=self.version,
            instruction_version=self.instruction_version, settings=self.settings or {},
            created_at=self.created_at, updated_at=self.updated_at,
        )
