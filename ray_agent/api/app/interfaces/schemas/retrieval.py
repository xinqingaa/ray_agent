"""工作区检索与运行背景清单（“本次参考”）的接口契约。"""
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.retrieval import SEARCH_HIT_LIMIT, SearchHit, SearchSourceType
from app.domain.models.run_context import RunContextManifest
from app.interfaces.schemas.event import to_epoch_ms

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class SearchRequest(BaseModel):
    """范围固定为路径里的工作区；可检索记忆、会话摘要与文件片段。"""
    query: str = Field(min_length=1, max_length=500)
    source_types: Optional[list[Literal["memory", "session_summary", "document_chunk"]]] = Field(
        default=None, description="省略为记忆、会话摘要与文件片段都查")
    limit: int = Field(default=SEARCH_HIT_LIMIT, ge=1, le=100)


class SearchHitView(BaseModel):
    model_config = _STRICT

    source_type: SearchSourceType
    source_id: str
    source_version: int
    title: str
    snippet: str
    score: float
    certainty: Optional[str] = None
    stale: bool
    payload: dict[str, Any]

    @classmethod
    def of(cls, hit: SearchHit) -> "SearchHitView":
        return cls(source_type=hit.source_type, source_id=hit.source_id, source_version=hit.source_version,
                   title=hit.title, snippet=hit.snippet, score=hit.score, certainty=hit.certainty,
                   stale=hit.stale, payload=dict(hit.payload))


class SearchResponse(BaseModel):
    model_config = _STRICT

    hits: list[SearchHitView]


class ResidentMemoryView(BaseModel):
    model_config = _STRICT

    memory_id: str
    version: int
    content: str
    memory_type: str
    certainty: str
    pinned: bool


class ContextOmissionView(BaseModel):
    model_config = _STRICT

    kind: str = Field(description="retrieval 为初始召回未采用，revision 为冻结后因不可用被移除")
    reason: str
    source_id: Optional[str] = None


class ContextManifestView(BaseModel):
    """一次运行实际使用的背景：工作方式版本、常驻记忆、初始召回与未采用原因。"""
    model_config = _STRICT

    run_id: str
    session_id: str
    workspace_id: Optional[str] = None
    instruction_version: Optional[int] = None
    instruction_body: Optional[str] = None
    resident_memories: list[ResidentMemoryView]
    retrieval_hits: list[SearchHitView]
    omissions: list[ContextOmissionView]
    created_at: int

    @classmethod
    def of(cls, manifest: RunContextManifest) -> "ContextManifestView":
        return cls(
            run_id=manifest.run_id, session_id=manifest.session_id, workspace_id=manifest.workspace_id,
            instruction_version=manifest.instruction_version, instruction_body=manifest.instruction_body,
            resident_memories=[ResidentMemoryView(**item.model_dump()) for item in manifest.resident_memories],
            retrieval_hits=[SearchHitView.of(hit) for hit in manifest.retrieval_hits],
            omissions=[ContextOmissionView(**item.model_dump()) for item in manifest.omissions],
            created_at=to_epoch_ms(manifest.created_at))
