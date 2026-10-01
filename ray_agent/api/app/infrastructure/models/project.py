"""长期项目 ORM；会话及活动运行的协调由仓库事务负责。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, Index, DateTime, String, Text, UniqueConstraint, ForeignKey, Integer, BigInteger, Boolean, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.models.workspace_project import WorkspaceProject
from .base import Base


class ProjectModel(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 160", name="ck_projects_name"),
        CheckConstraint("instructions IS NULL OR char_length(instructions) <= 8000", name="ck_projects_instructions"),
        CheckConstraint("char_length(notes) <= 8000", name="ck_projects_notes"),
    )
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default='', server_default='')
    notes_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default='0')
    settings_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default='0')
    file_operation: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    files_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')
    files_size_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    files_size_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text('false'))
    protection: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    snapshot_gc_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text('false'))
    snapshots_cleaned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    snapshots_released_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP(0)"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP(0)"))
    last_active_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    @classmethod
    def from_domain(cls, project: WorkspaceProject) -> "ProjectModel":
        values = project.model_dump(mode="python", exclude={"file_operation"})
        values["file_operation"] = project.file_operation.model_dump(mode="json") if project.file_operation else None
        return cls(**values)

    def to_domain(self) -> WorkspaceProject:
        return WorkspaceProject.model_validate(self, from_attributes=True)


class ProjectAuditModel(Base):
    __tablename__ = 'project_audit_events'
    project_id: Mapped[str] = mapped_column(String(255), ForeignKey('projects.id', ondelete='RESTRICT'), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)


class ProjectSnapshotModel(Base):
    __tablename__ = 'project_snapshots'
    __table_args__ = (CheckConstraint("source IN ('run', 'upload', 'restore')", name='ck_project_snapshots_source'),)
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(255), ForeignKey('projects.id', ondelete='RESTRICT'), index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    total_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ProjectFileCopyModel(Base):
    __tablename__ = 'project_file_copies'
    __table_args__ = (Index('uq_project_file_copies_path', 'project_id', 'path', unique=True,
        postgresql_where=text("resolved_path IS NULL OR resolved_path NOT LIKE '/workspace/%'")),)
    project_id: Mapped[str] = mapped_column(String(255), ForeignKey('projects.id', ondelete='RESTRICT'), primary_key=True)
    copy_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    attachment_id: Mapped[str] = mapped_column(String(255), nullable=False)
    session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    run_id: Mapped[str] = mapped_column(String(255), nullable=False)
    resolved_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tool_call_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    message_seq: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
