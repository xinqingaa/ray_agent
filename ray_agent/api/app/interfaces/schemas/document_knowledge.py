"""文档索引状态与来源读取契约。"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.document_knowledge import (
    DocumentFormat, DocumentIndexStatus, DocumentLocator, DocumentOcrState, DocumentRecord, DocumentRevision, WorkspaceIndexSummary,
)
from app.domain.models.identity import RelativePath
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
    size: int | None = None
    page_count: int | None = None
    error_message: str | None = None
    component_needed: str | None = None
    ocr_state: DocumentOcrState | None = None
    ocr_pages_pending: int | None = None
    ocr_error: str | None = None

    @classmethod
    def of(cls, doc: DocumentRecord, revision: DocumentRevision | None = None) -> "DocumentView":
        return cls(
            id=doc.id, relative_path=doc.relative_path, current_revision=doc.current_revision,
            status=doc.status, format=doc.format.value, updated_at=to_epoch_ms(doc.updated_at),
            size=revision.size if revision else None, page_count=revision.page_count if revision else None,
            error_message=revision.error_message if revision else None,
            component_needed=revision.component_needed if revision else None,
            ocr_state=revision.ocr_state if revision else None,
            ocr_pages_pending=revision.ocr_pages_pending if revision else None,
            ocr_error=revision.ocr_error if revision else None,
        )


class DocumentPage(BaseModel):
    items: list[DocumentView]
    next_after: str | None = None


class IndexSummaryView(WorkspaceIndexSummary):
    model_config = _STRICT

    @classmethod
    def of(cls, summary: WorkspaceIndexSummary) -> "IndexSummaryView":
        return cls(**summary.model_dump())


class DocumentSourceView(BaseModel):
    model_config = _STRICT

    source_type: Literal["document_chunk"]
    source_id: str
    document_id: str
    revision: int
    relative_path: str
    title: str
    body: str
    locator: DocumentLocator
    stale: bool
    format: DocumentFormat
    root_id: str
    current_revision: int
    preview_revision: str | None = None
    cells: list[list[str]] | None = None


class SyncIndexRequest(BaseModel):
    paths: Optional[list[RelativePath]] = Field(default=None, max_length=200, description="省略则全量对照文件夹重扫")


class IndexPolicyRequest(BaseModel):
    version: int = Field(ge=0)
    paused: bool
    excluded_directories: list[RelativePath] = Field(max_length=200)
    scope_confirmed: bool


class RetryIndexRequest(BaseModel):
    document_id: str | None = None
    revision: int | None = Field(default=None, ge=1)
