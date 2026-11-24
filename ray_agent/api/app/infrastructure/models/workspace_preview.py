"""应用内项目预览声明表的 ORM 模型。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.models.clock import utc_now
from app.domain.models.workspace_preview import PreviewKind, WorkspacePreview
from .base import Base, UTCDateTime


class WorkspacePreviewModel(Base):
    __tablename__ = "workspace_previews"
    __table_args__ = (
        Index("ix_workspace_previews_session", "session_id", "updated_at"),
        Index("ix_workspace_previews_workspace", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[Optional[str]] = mapped_column(
        String(128), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    session_id: Mapped[str] = mapped_column(
        String(128), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[Optional[str]] = mapped_column(
        String(128), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    root_id: Mapped[str] = mapped_column(String(128), nullable=False)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    entry_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    start_command: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    health_path: Mapped[str] = mapped_column(String(512), nullable=False, default="/")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, preview: WorkspacePreview) -> "WorkspacePreviewModel":
        return cls(**preview.model_dump(mode="python"))

    def to_domain(self) -> WorkspacePreview:
        kind: PreviewKind = "service" if self.kind == "service" else "static"
        return WorkspacePreview(
            id=self.id,
            workspace_id=self.workspace_id,
            session_id=self.session_id,
            run_id=self.run_id,
            name=self.name,
            kind=kind,
            root_id=self.root_id,
            relative_path=self.relative_path or "",
            entry_path=self.entry_path or "",
            start_command=self.start_command,
            health_path=self.health_path or "/",
            created_at=self.created_at,
            updated_at=self.updated_at,
        )
