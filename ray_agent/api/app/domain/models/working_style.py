"""工作方式：挂在工作区上的带版本短文本；提议经用户确认后发布；模板只复制配置。"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import InstructionVersion, SessionId, WorkspaceId

# 工作方式正文上限；实际默认值见参数页
INSTRUCTION_MAX_CHARS = 4000


class InstructionSource(StrEnum):
    USER_EDIT = "user_edit"
    CONFIRMED_PROPOSAL = "confirmed_proposal"
    TEMPLATE = "template"


class ProposalStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


class InstructionVersionRecord(BaseModel):
    workspace_id: WorkspaceId
    version: InstructionVersion
    body: str = Field(max_length=INSTRUCTION_MAX_CHARS)
    source: InstructionSource
    proposal_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class InstructionProposal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    workspace_id: WorkspaceId
    base_version: InstructionVersion
    body: str = Field(max_length=INSTRUCTION_MAX_CHARS)
    rationale: str = ""
    session_id: Optional[SessionId] = None
    status: ProposalStatus = ProposalStatus.PENDING
    created_at: datetime = Field(default_factory=utc_now)
    resolved_at: Optional[datetime] = None


class WorkingStyleTemplate(BaseModel):
    """模板是工作方式与工具启用建议的副本；应用时不带记忆、路径或凭据。"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1, max_length=80)
    body: str = Field(max_length=INSTRUCTION_MAX_CHARS)
    tool_suggestions: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
