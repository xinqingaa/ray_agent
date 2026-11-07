"""会话摘要与运行背景清单 ORM。"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.run_context import RunContextManifest
from ...domain.models.session_summary_record import SessionSummaryRecord, SummaryState


class SessionSummaryModel(Base):
    __tablename__ = "session_summaries"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="ready")
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, record: SessionSummaryRecord) -> "SessionSummaryModel":
        return cls(
            session_id=record.session_id, workspace_id=record.workspace_id, body=record.body,
            source_seq=record.source_seq, generation=record.generation, model=record.model,
            state=record.state.value, updated_at=record.updated_at, created_at=record.created_at,
        )

    def to_domain(self) -> SessionSummaryRecord:
        return SessionSummaryRecord(
            session_id=self.session_id, workspace_id=self.workspace_id, body=self.body,
            source_seq=self.source_seq, generation=self.generation, model=self.model,
            state=SummaryState(self.state), updated_at=self.updated_at, created_at=self.created_at,
        )


class RunContextManifestModel(Base):
    __tablename__ = "run_context_manifests"

    run_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    instruction_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    instruction_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resident_memories: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    retrieval_hits: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    omissions: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, manifest: RunContextManifest) -> "RunContextManifestModel":
        payload = manifest.model_dump(mode="json")
        return cls(
            run_id=manifest.run_id, session_id=manifest.session_id, workspace_id=manifest.workspace_id,
            instruction_version=manifest.instruction_version, instruction_body=manifest.instruction_body,
            resident_memories=payload.get("resident_memories") or [],
            retrieval_hits=payload.get("retrieval_hits") or [],
            omissions=payload.get("omissions") or [],
            created_at=manifest.created_at,
        )

    def to_domain(self) -> RunContextManifest:
        return RunContextManifest.model_validate({
            "run_id": self.run_id,
            "session_id": self.session_id,
            "workspace_id": self.workspace_id,
            "instruction_version": self.instruction_version,
            "instruction_body": self.instruction_body,
            "resident_memories": self.resident_memories or [],
            "retrieval_hits": self.retrieval_hits or [],
            "omissions": self.omissions or [],
            "created_at": self.created_at,
        })
