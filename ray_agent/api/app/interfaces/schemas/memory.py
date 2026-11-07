"""工作区记忆的接口契约；时间为毫秒时间戳。条目的工作区由路径决定，请求体里没有工作区身份。"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.workspace_memory import (
    MEMORY_CONTENT_MAX_CHARS,
    RESIDENT_MEMORY_LIMIT,
    MemoryCertainty,
    MemoryChange,
    MemoryChangeAction,
    MemoryEntry,
    MemoryOrigin,
    MemorySource,
    MemorySourceKind,
    MemoryStatus,
    MemoryType,
)
from app.interfaces.schemas.event import to_epoch_ms

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class MemoryItem(BaseModel):
    model_config = _STRICT

    id: str
    workspace_id: str
    content: str
    memory_type: MemoryType
    origin: MemoryOrigin
    certainty: MemoryCertainty
    status: MemoryStatus
    pinned: bool
    version: int = Field(description="修改时回传，用于并发修改核对")
    supersedes_id: Optional[str] = Field(default=None, description="候选指向的、确认后将被替代的条目")
    resident: bool = Field(description="当前是否在常驻层（每次新运行注入）")
    created_at: int
    updated_at: int
    last_used_at: Optional[int] = None

    @classmethod
    def of(cls, entry: MemoryEntry, resident_ids: frozenset[str] = frozenset()) -> "MemoryItem":
        return cls(
            id=entry.id, workspace_id=entry.workspace_id, content=entry.content, memory_type=entry.memory_type,
            origin=entry.origin, certainty=entry.certainty, status=entry.status, pinned=entry.pinned,
            version=entry.version, supersedes_id=entry.supersedes_id, resident=entry.id in resident_ids,
            created_at=to_epoch_ms(entry.created_at), updated_at=to_epoch_ms(entry.updated_at),
            last_used_at=to_epoch_ms(entry.last_used_at) if entry.last_used_at else None)


class MemoryListResponse(BaseModel):
    model_config = _STRICT

    memories: list[MemoryItem]
    resident_limit: int = RESIDENT_MEMORY_LIMIT


class CreateMemoryRequest(BaseModel):
    content: str = Field(min_length=1, max_length=MEMORY_CONTENT_MAX_CHARS)
    memory_type: MemoryType = MemoryType.FACT
    pinned: bool = False


class PatchMemoryRequest(BaseModel):
    """对一条记忆的用户操作；version 必须回传。edit 需要 content 或 memory_type 之一。"""
    action: Literal["edit", "pin", "unpin", "confirm", "retract", "undo"]
    version: int = Field(ge=1)
    content: Optional[str] = Field(default=None, min_length=1, max_length=MEMORY_CONTENT_MAX_CHARS)
    memory_type: Optional[MemoryType] = None


class MemorySourceView(BaseModel):
    model_config = _STRICT

    id: str
    kind: MemorySourceKind
    session_id: Optional[str] = None
    event_seq_start: Optional[int] = None
    event_seq_end: Optional[int] = None
    document_id: Optional[str] = None
    document_revision: Optional[int] = None
    available: bool = Field(description="来源会话或文件仍然存在；为假时界面如实标明，不跳转到别处")

    @classmethod
    def of(cls, source: MemorySource) -> "MemorySourceView":
        return cls(id=source.id, kind=source.kind, session_id=source.session_id,
                   event_seq_start=source.event_seq_start, event_seq_end=source.event_seq_end,
                   document_id=source.document_id, document_revision=source.document_revision,
                   available=source.available)


class MemoryChangeView(BaseModel):
    model_config = _STRICT

    id: str
    from_version: Optional[int] = None
    to_version: int
    action: MemoryChangeAction
    origin: MemoryOrigin
    rationale: str
    replaces_change_id: Optional[str] = None
    created_at: int

    @classmethod
    def of(cls, change: MemoryChange) -> "MemoryChangeView":
        return cls(id=change.id, from_version=change.from_version, to_version=change.to_version,
                   action=change.action, origin=change.origin, rationale=change.rationale,
                   replaces_change_id=change.replaces_change_id, created_at=to_epoch_ms(change.created_at))


class MemorySourcesResponse(BaseModel):
    model_config = _STRICT

    sources: list[MemorySourceView]
    changes: list[MemoryChangeView]


class ParticipateInMemoryRequest(BaseModel):
    participate: bool


class ParticipateInMemoryResponse(BaseModel):
    model_config = _STRICT

    session_id: str
    participate_in_memory: bool


class AutoMemoryRequest(BaseModel):
    enabled: bool
    version: int = Field(ge=1)
