"""文档索引状态与来源读取契约。"""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.document_knowledge import DocumentIndexStatus, DocumentRecord, WorkspaceIndexSummary
from app.interfaces.schemas.event import to_epoch_ms

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class DocumentView(BaseModel):
    model_config = _STRICT

    id: str
    relative_path: str
    current_revision: int
    status: DocumentIndexStatus
    format: str
    updated_at: int

    @classmethod
    def of(cls, doc: DocumentRecord) -> "DocumentView":
        return cls(
            id=doc.id, relative_path=doc.relative_path, current_revision=doc.current_revision,
            status=doc.status, format=doc.format.value, updated_at=to_epoch_ms(doc.updated_at),
        )


class IndexSummaryView(BaseModel):
    model_config = _STRICT

    workspace_id: str
    total: int
    searchable: int
    pending: int
    parsing: int
    pending_component: int
    failed: int
    withdrawn: int
    truncated_scan: bool
    active_operation_id: Optional[str] = None
    publication_generation: int
    vector_generation: Optional[int] = None
    embedding_config: Optional[str] = None
    semantic_ready: bool = False

    @classmethod
    def of(cls, summary: WorkspaceIndexSummary) -> "IndexSummaryView":
        return cls(**summary.model_dump())


class DocumentSourceView(BaseModel):
    model_config = _STRICT

    source_type: str
    source_id: str
    document_id: str
    revision: int
    relative_path: str
    title: str
    body: str
    locator: dict[str, Any]
    stale: bool


class SyncIndexRequest(BaseModel):
    paths: Optional[list[str]] = Field(default=None, description="省略则全量对照文件夹重扫")
