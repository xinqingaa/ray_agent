"""工作区检索端口：统一查询记忆、会话摘要与（P6）文件片段；本包只接入前两者。"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import WorkspaceId

# 单次检索命中上限；实际默认值见参数页
SEARCH_HIT_LIMIT = 20
INITIAL_RECALL_LIMIT = 8
INITIAL_RECALL_CHARS = 4000


class SearchSourceType(StrEnum):
    MEMORY = "memory"
    SESSION_SUMMARY = "session_summary"
    DOCUMENT_CHUNK = "document_chunk"  # P6 挂接；本包不写入


class SearchDocument(BaseModel):
    id: str
    workspace_id: WorkspaceId
    source_type: SearchSourceType
    source_id: str
    source_version: int = 1
    title: str = ""
    body: str
    tokenized: str
    payload: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=utc_now)


class SearchHit(BaseModel):
    source_type: SearchSourceType
    source_id: str
    source_version: int
    title: str = ""
    snippet: str
    score: float = 0.0
    certainty: Optional[str] = None
    stale: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)


class SearchQuery(BaseModel):
    workspace_id: WorkspaceId
    query: str = Field(min_length=1, max_length=500)
    source_types: list[SearchSourceType] = Field(
        default_factory=lambda: [SearchSourceType.MEMORY, SearchSourceType.SESSION_SUMMARY]
    )
    limit: int = Field(default=SEARCH_HIT_LIMIT, ge=1, le=100)
    match_any: bool = False  # 为真时任一词命中即可（初始召回）；默认所有词都要命中
