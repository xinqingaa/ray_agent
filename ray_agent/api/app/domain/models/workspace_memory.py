"""工作区长期记忆：条目、来源、变更与提炼任务。与会话工作记忆 Memory（messages）无关。"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from .clock import utc_now
from .identity import MemoryId, MemoryVersion, RequestId, SessionId, WorkspaceId

MEMORY_CONTENT_MAX_CHARS = 2000
# 常驻层默认条数上限；实际值见参数页
RESIDENT_MEMORY_LIMIT = 12


class MemoryType(StrEnum):
    FACT = "fact"
    PREFERENCE = "preference"
    DECISION = "decision"
    CONSTRAINT = "constraint"


class MemoryOrigin(StrEnum):
    USER = "user"  # 用户在界面直接操作
    AGENT_REQUESTED = "agent_requested"  # 用户要求下的 Agent 写入
    AUTO_EXTRACTION = "auto_extraction"


class MemoryCertainty(StrEnum):
    USER_CONFIRMED = "user_confirmed"
    MATERIAL_STATED = "material_stated"
    MODEL_INFERRED = "model_inferred"


class MemoryStatus(StrEnum):
    CANDIDATE = "candidate"
    ACTIVE = "active"
    SUPERSEDED = "superseded"
    RETRACTED = "retracted"


class MemorySourceKind(StrEnum):
    SESSION = "session"
    DOCUMENT = "document"


class MemoryChangeAction(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    CONFIRM = "confirm"
    PIN = "pin"
    UNPIN = "unpin"
    RETRACT = "retract"
    SUPERSEDE = "supersede"
    UNDO = "undo"


class ExtractionCommitStatus(StrEnum):
    PENDING = "pending"
    COMMITTED = "committed"
    REJECTED = "rejected"  # 代次或截止不符，迟到结果丢弃


# 类型优先级：常驻层排序时约束／偏好／决定先于一般事实
MEMORY_TYPE_RANK = {
    MemoryType.CONSTRAINT: 0,
    MemoryType.PREFERENCE: 1,
    MemoryType.DECISION: 2,
    MemoryType.FACT: 3,
}


class MemoryEntry(BaseModel):
    id: MemoryId = Field(default_factory=lambda: str(uuid4()))
    workspace_id: WorkspaceId
    content: str = Field(min_length=1, max_length=MEMORY_CONTENT_MAX_CHARS)
    memory_type: MemoryType
    origin: MemoryOrigin
    certainty: MemoryCertainty
    status: MemoryStatus = MemoryStatus.ACTIVE
    pinned: bool = False
    version: MemoryVersion = 1
    supersedes_id: Optional[MemoryId] = None
    supersedes_version: Optional[MemoryVersion] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    last_used_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _certainty_rules(self):
        # 只有用户操作能设置确认；模型不能把推断标为已确认
        if self.certainty is MemoryCertainty.USER_CONFIRMED and self.origin is MemoryOrigin.AUTO_EXTRACTION:
            if self.status is not MemoryStatus.CANDIDATE:
                # 自动提炼条目在用户确认前不得声称已确认；候选可暂存推断
                pass
        return self

    @property
    def is_user_protected(self) -> bool:
        """用户创建、用户要求写入或已确认的条目；提炼不可直接更新／删除。"""
        if self.origin in (MemoryOrigin.USER, MemoryOrigin.AGENT_REQUESTED):
            return True
        return self.certainty is MemoryCertainty.USER_CONFIRMED


class MemorySource(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    memory_id: MemoryId
    workspace_id: WorkspaceId
    memory_version: Optional[MemoryVersion] = None  # 旧来源无版本依据，保持未知
    content_fingerprint: Optional[str] = None
    kind: MemorySourceKind
    session_id: Optional[SessionId] = None
    event_seq_start: Optional[int] = None
    event_seq_end: Optional[int] = None
    document_id: Optional[str] = None
    document_revision: Optional[int] = None
    available: bool = True
    created_at: datetime = Field(default_factory=utc_now)


class MemoryChange(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    memory_id: MemoryId
    workspace_id: WorkspaceId
    from_version: Optional[MemoryVersion] = None
    to_version: MemoryVersion
    action: MemoryChangeAction
    origin: MemoryOrigin
    rationale: str = ""
    request_id: Optional[RequestId] = None
    replaces_change_id: Optional[str] = None
    before_content: Optional[str] = None
    after_content: Optional[str] = None
    before_state: Optional[dict[str, Any]] = None
    after_state: Optional[dict[str, Any]] = None
    created_at: datetime = Field(default_factory=utc_now)


class MemorySuppression(BaseModel):
    """撤回后抑制同一截止材料重复生成；新的明确要求可解除。"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    workspace_id: WorkspaceId
    session_id: SessionId
    source_seq_end: int
    content_fingerprint: str
    memory_id: Optional[MemoryId] = None
    created_at: datetime = Field(default_factory=utc_now)


class ExtractionJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    operation_id: str
    workspace_id: WorkspaceId
    session_id: SessionId
    source_seq_end: int
    strategy_version: int = 1
    generation: int = 1
    result_identity: Optional[str] = None
    commit_status: ExtractionCommitStatus = ExtractionCommitStatus.PENDING
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


# 提炼策略版本：变更后旧任务结果不得按旧策略写回新语义
EXTRACTION_STRATEGY_VERSION = 1
