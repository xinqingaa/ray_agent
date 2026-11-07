"""工作方式版本、提议与模板的 ORM。"""
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import Boolean, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.working_style import (
    InstructionProposal,
    InstructionSource,
    InstructionVersionRecord,
    ProposalStatus,
    WorkingStyleTemplate,
)


class InstructionVersionModel(Base):
    __tablename__ = "instruction_versions"

    workspace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    proposal_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, record: InstructionVersionRecord) -> "InstructionVersionModel":
        return cls(
            workspace_id=record.workspace_id, version=record.version, body=record.body,
            source=record.source.value, proposal_id=record.proposal_id, created_at=record.created_at,
        )

    def to_domain(self) -> InstructionVersionRecord:
        return InstructionVersionRecord(
            workspace_id=self.workspace_id, version=self.version, body=self.body,
            source=InstructionSource(self.source), proposal_id=self.proposal_id, created_at=self.created_at,
        )


class InstructionProposalModel(Base):
    __tablename__ = "instruction_proposals"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    base_version: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    session_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    @classmethod
    def from_domain(cls, proposal: InstructionProposal) -> "InstructionProposalModel":
        return cls(
            id=proposal.id, workspace_id=proposal.workspace_id, base_version=proposal.base_version,
            body=proposal.body, rationale=proposal.rationale, session_id=proposal.session_id,
            status=proposal.status.value, created_at=proposal.created_at, resolved_at=proposal.resolved_at,
        )

    def to_domain(self) -> InstructionProposal:
        return InstructionProposal(
            id=self.id, workspace_id=self.workspace_id, base_version=self.base_version, body=self.body,
            rationale=self.rationale, session_id=self.session_id, status=ProposalStatus(self.status),
            created_at=self.created_at, resolved_at=self.resolved_at,
        )


class WorkingStyleTemplateModel(Base):
    __tablename__ = "working_style_templates"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tool_suggestions: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, template: WorkingStyleTemplate) -> "WorkingStyleTemplateModel":
        return cls(
            id=template.id, name=template.name, body=template.body,
            tool_suggestions=dict(template.tool_suggestions or {}),
            created_at=template.created_at, updated_at=template.updated_at,
        )

    def to_domain(self) -> WorkingStyleTemplate:
        return WorkingStyleTemplate(
            id=self.id, name=self.name, body=self.body,
            tool_suggestions=dict(self.tool_suggestions or {}),
            created_at=self.created_at, updated_at=self.updated_at,
        )
