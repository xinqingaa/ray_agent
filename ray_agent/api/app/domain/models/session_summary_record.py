"""持久化的会话摘要：只读正文，用于列表与跨会话检索，不提升为记忆。"""
from datetime import datetime
from enum import StrEnum
from typing import Optional

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import SessionId, WorkspaceId


class SummaryState(StrEnum):
    READY = "ready"
    GENERATING = "generating"
    FAILED = "failed"


class SessionSummaryRecord(BaseModel):
    session_id: SessionId
    workspace_id: Optional[WorkspaceId] = None
    body: str = ""
    source_seq: int = 0
    generation: int = 1
    model: Optional[str] = None
    state: SummaryState = SummaryState.READY
    updated_at: datetime = Field(default_factory=utc_now)
    created_at: datetime = Field(default_factory=utc_now)
