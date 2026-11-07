"""记忆条目、来源、变更、抑制与提炼任务 ORM。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.workspace_memory import (
    ExtractionCommitStatus,
    ExtractionJob,
    MemoryCertainty,
    MemoryChange,
    MemoryChangeAction,
    MemoryEntry,
    MemoryOrigin,
    MemorySource,
    MemorySourceKind,
    MemoryStatus,
    MemorySuppression,
    MemoryType,
)


class MemoryEntryModel(Base):
    __tablename__ = "memory_entries"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    memory_type: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(32), nullable=False)
    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    supersedes_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    @classmethod
    def from_domain(cls, entry: MemoryEntry) -> "MemoryEntryModel":
        return cls(
            id=entry.id, workspace_id=entry.workspace_id, content=entry.content,
            memory_type=entry.memory_type.value, origin=entry.origin.value,
            certainty=entry.certainty.value, status=entry.status.value, pinned=entry.pinned,
            version=entry.version, supersedes_id=entry.supersedes_id, created_at=entry.created_at,
            updated_at=entry.updated_at, last_used_at=entry.last_used_at,
        )

    def to_domain(self) -> MemoryEntry:
        return MemoryEntry(
            id=self.id, workspace_id=self.workspace_id, content=self.content,
            memory_type=MemoryType(self.memory_type), origin=MemoryOrigin(self.origin),
            certainty=MemoryCertainty(self.certainty), status=MemoryStatus(self.status),
            pinned=self.pinned, version=self.version, supersedes_id=self.supersedes_id,
            created_at=self.created_at, updated_at=self.updated_at, last_used_at=self.last_used_at,
        )


class MemorySourceModel(Base):
    __tablename__ = "memory_sources"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    memory_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    session_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    event_seq_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    event_seq_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    document_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    document_revision: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, source: MemorySource) -> "MemorySourceModel":
        return cls(**{**source.model_dump(mode="python"), "kind": source.kind.value})

    def to_domain(self) -> MemorySource:
        return MemorySource(
            id=self.id, memory_id=self.memory_id, workspace_id=self.workspace_id,
            kind=MemorySourceKind(self.kind), session_id=self.session_id,
            event_seq_start=self.event_seq_start, event_seq_end=self.event_seq_end,
            document_id=self.document_id, document_revision=self.document_revision,
            available=self.available, created_at=self.created_at,
        )


class MemoryChangeModel(Base):
    __tablename__ = "memory_changes"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    memory_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    from_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    to_version: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    origin: Mapped[str] = mapped_column(String(32), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    replaces_change_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    before_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, change: MemoryChange) -> "MemoryChangeModel":
        data = change.model_dump(mode="python")
        data["action"] = change.action.value
        data["origin"] = change.origin.value
        return cls(**data)

    def to_domain(self) -> MemoryChange:
        return MemoryChange(
            id=self.id, memory_id=self.memory_id, workspace_id=self.workspace_id,
            from_version=self.from_version, to_version=self.to_version,
            action=MemoryChangeAction(self.action), origin=MemoryOrigin(self.origin),
            rationale=self.rationale, request_id=self.request_id,
            replaces_change_id=self.replaces_change_id, before_content=self.before_content,
            after_content=self.after_content, created_at=self.created_at,
        )


class MemorySuppressionModel(Base):
    __tablename__ = "memory_suppressions"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_seq_end: Mapped[int] = mapped_column(Integer, nullable=False)
    content_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    memory_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, item: MemorySuppression) -> "MemorySuppressionModel":
        return cls(**item.model_dump(mode="python"))

    def to_domain(self) -> MemorySuppression:
        return MemorySuppression(
            id=self.id, workspace_id=self.workspace_id, session_id=self.session_id,
            source_seq_end=self.source_seq_end, content_fingerprint=self.content_fingerprint,
            memory_id=self.memory_id, created_at=self.created_at,
        )


class ExtractionJobModel(Base):
    __tablename__ = "extraction_jobs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_seq_end: Mapped[int] = mapped_column(Integer, nullable=False)
    strategy_version: Mapped[int] = mapped_column(Integer, nullable=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False)
    result_identity: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    commit_status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, job: ExtractionJob) -> "ExtractionJobModel":
        data = job.model_dump(mode="python")
        data["commit_status"] = job.commit_status.value
        return cls(**data)

    def to_domain(self) -> ExtractionJob:
        return ExtractionJob(
            id=self.id, operation_id=self.operation_id, workspace_id=self.workspace_id,
            session_id=self.session_id, source_seq_end=self.source_seq_end,
            strategy_version=self.strategy_version, generation=self.generation,
            result_identity=self.result_identity, commit_status=ExtractionCommitStatus(self.commit_status),
            created_at=self.created_at, updated_at=self.updated_at,
        )
