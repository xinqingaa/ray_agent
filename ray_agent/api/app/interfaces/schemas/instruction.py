"""工作方式、提议与模板的接口契约；时间为毫秒时间戳。"""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.working_style import (
    INSTRUCTION_MAX_CHARS,
    InstructionProposal,
    InstructionSource,
    InstructionVersionRecord,
    ProposalStatus,
    WorkingStyleTemplate,
)
from app.interfaces.schemas.event import to_epoch_ms

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class InstructionView(BaseModel):
    """工作区当前生效的工作方式；尚未设置时 instruction_version 与 source 为空、正文为空串。"""
    model_config = _STRICT

    workspace_id: str
    instruction_version: Optional[int] = None
    body: str
    source: Optional[InstructionSource] = None
    updated_at: Optional[int] = None
    workspace_version: int = Field(description="工作区 version；提交修改时回传，用于并发修改核对")
    max_chars: int = INSTRUCTION_MAX_CHARS

    @classmethod
    def of(cls, workspace, record: Optional[InstructionVersionRecord]) -> "InstructionView":
        return cls(
            workspace_id=workspace.id, instruction_version=record.version if record else None,
            body=record.body if record else "", source=record.source if record else None,
            updated_at=to_epoch_ms(record.created_at) if record else None, workspace_version=workspace.version)


class UpdateInstructionRequest(BaseModel):
    body: str = Field(max_length=INSTRUCTION_MAX_CHARS, description="新的工作方式全文；可为空串表示清除")
    version: int = Field(ge=1, description="工作区 version；不符返回 409 并带最新值")


class InstructionProposalView(BaseModel):
    model_config = _STRICT

    id: str
    workspace_id: str
    base_version: int
    body: str
    rationale: str
    session_id: Optional[str] = None
    status: ProposalStatus
    created_at: int
    resolved_at: Optional[int] = None

    @classmethod
    def of(cls, proposal: InstructionProposal) -> "InstructionProposalView":
        return cls(
            id=proposal.id, workspace_id=proposal.workspace_id, base_version=proposal.base_version,
            body=proposal.body, rationale=proposal.rationale, session_id=proposal.session_id,
            status=proposal.status, created_at=to_epoch_ms(proposal.created_at),
            resolved_at=to_epoch_ms(proposal.resolved_at) if proposal.resolved_at else None)


class InstructionProposalList(BaseModel):
    model_config = _STRICT

    proposals: list[InstructionProposalView]


class TemplateView(BaseModel):
    model_config = _STRICT

    id: str
    name: str
    body: str
    tool_suggestions: dict[str, Any]
    created_at: int
    updated_at: int

    @classmethod
    def of(cls, template: WorkingStyleTemplate) -> "TemplateView":
        return cls(id=template.id, name=template.name, body=template.body,
                   tool_suggestions=dict(template.tool_suggestions), created_at=to_epoch_ms(template.created_at),
                   updated_at=to_epoch_ms(template.updated_at))


class TemplateListResponse(BaseModel):
    model_config = _STRICT

    templates: list[TemplateView]


class SaveTemplateRequest(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=200)
    include_tool_suggestions: bool = Field(default=False, description="同时保存工具启用建议（只含本机执行开关）")


class RenameTemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ApplyTemplateRequest(BaseModel):
    workspace_id: str
    version: Optional[int] = Field(default=None, ge=1, description="工作区 version；提供时核对并发修改")


class ApplyTemplateResponse(BaseModel):
    """应用模板只发布工作方式新版本；tool_suggestions 是模板里的建议，不会自动启用任何开关。"""
    model_config = _STRICT

    instruction: InstructionView
    tool_suggestions: dict[str, Any]
