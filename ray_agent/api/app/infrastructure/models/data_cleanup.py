from datetime import datetime
from sqlalchemy import DateTime, String, Integer, Text, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base
from app.domain.models.data_cleanup import CleanupTask


class DataCleanupModel(Base):
    __tablename__ = 'data_cleanup_tasks'
    __table_args__ = (Index('uq_data_cleanup_pending', text('(1)'), unique=True,
        postgresql_where=text("state <> 'completed'")),)
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    phase: Mapped[str] = mapped_column(String(24), nullable=False)
    completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    manifest: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)

    def to_domain(self):
        return CleanupTask(id=self.id, scope=self.scope, project_id=self.project_id, name=self.name,
            state=self.state, phase=self.phase, completed=self.completed, total=self.total,
            error=self.error, created_at=self.created_at, updated_at=self.updated_at, **self.manifest)
