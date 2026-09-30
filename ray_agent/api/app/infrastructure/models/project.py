"""长期项目 ORM；会话及活动运行的协调由仓库事务负责。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.models.workspace_project import WorkspaceProject
from .base import Base


class ProjectModel(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("path", name="uq_projects_path"),
        CheckConstraint("char_length(name) BETWEEN 1 AND 160", name="ck_projects_name"),
        CheckConstraint("instructions IS NULL OR char_length(instructions) <= 8000", name="ck_projects_instructions"),
        CheckConstraint("(git_author_name IS NULL) = (git_author_email IS NULL)", name="ck_projects_git_identity_pair"),
    )
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    path: Mapped[str] = mapped_column(String(4096), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    git_author_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    git_author_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP(0)"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP(0)"))
    last_active_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    @classmethod
    def from_domain(cls, project: WorkspaceProject) -> "ProjectModel":
        return cls(**project.model_dump(mode="python"))

    def to_domain(self) -> WorkspaceProject:
        return WorkspaceProject.model_validate(self, from_attributes=True)
