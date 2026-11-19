"""工作区文档知识：登记、修订、结构块、片段与索引发布。

索引发布与权威可见状态在 SQLite；片段经检索端口写入 FTS；向量代次对齐 generation。
"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import WorkspaceId
from .operation import OperationProgress
from .semantic_index import EMBEDDING_CONFIG_FINGERPRINT

# 解析／切分配置指纹：任一变化需重建派生索引；Embedding 配置另起空间
PARSE_CONFIG_FINGERPRINT = "p6-parse-v2"
CHUNK_CONFIG_FINGERPRINT = "p6-chunk-v2"

# 单文件解析与入库上限（字节／字符）；默认值同步参数页
DOCUMENT_PARSE_MAX_BYTES = 32 * 1024 * 1024
DOCUMENT_CHUNK_CHARS = 800
DOCUMENT_CHUNK_OVERLAP = 80
DOCUMENT_TABLE_ROWS_PER_CHUNK = 40
DOCUMENT_INDEX_SCAN_BATCH = 200
DOCUMENT_SCOPE_REVIEW_FILES = 1000
DOCUMENT_SCOPE_REVIEW_BYTES = 512 * 1024 * 1024


class DocumentIndexStatus(StrEnum):
    """界面与 API 可见的索引状态；扫描件在缺 OCR 时停在 pending_component。"""
    REGISTERED = "registered"
    PENDING_PARSE = "pending_parse"
    PARSING = "parsing"
    PENDING_COMPONENT = "pending_component"
    INDEXING = "indexing"
    SEARCHABLE = "searchable"
    FAILED = "failed"
    WITHDRAWN = "withdrawn"
    EXCLUDED = "excluded"


class DocumentFormat(StrEnum):
    TEXT = "text"
    MARKDOWN = "markdown"
    CODE = "code"
    JSON = "json"
    HTML = "html"
    PDF = "pdf"
    DOCX = "docx"
    PPTX = "pptx"
    XLSX = "xlsx"
    CSV = "csv"
    TSV = "tsv"
    IMAGE = "image"
    UNSUPPORTED = "unsupported"


class DocumentOcrState(StrEnum):
    NOT_NEEDED = "not_needed"
    WAITING_COMPONENT = "waiting_component"
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


class DocumentRecord(BaseModel):
    id: str
    workspace_id: WorkspaceId
    relative_path: str
    current_revision: int = 0
    source_epoch: int = 0
    status: DocumentIndexStatus = DocumentIndexStatus.REGISTERED
    format: DocumentFormat = DocumentFormat.UNSUPPORTED
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class DocumentRevision(BaseModel):
    id: str
    document_id: str
    workspace_id: WorkspaceId
    revision: int
    source_epoch: int = 0
    relative_path: str
    content_hash: str
    size: int = 0
    modified_ns: int = 0
    page_count: int | None = None
    status: DocumentIndexStatus = DocumentIndexStatus.PENDING_PARSE
    format: DocumentFormat = DocumentFormat.UNSUPPORTED
    parse_config: str = PARSE_CONFIG_FINGERPRINT
    chunk_config: str = CHUNK_CONFIG_FINGERPRINT
    staging_object_id: Optional[str] = None  # 解析产物暂存；发布成功后仍可保留供核对
    error_message: Optional[str] = None
    component_needed: Optional[str] = None  # 如 ocr；P7 安装后重试
    ocr_state: DocumentOcrState | None = None
    ocr_pages_pending: int | None = None
    ocr_error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    published_at: Optional[datetime] = None


class ContentBlock(BaseModel):
    id: str
    revision_id: str
    workspace_id: WorkspaceId
    ordinal: int
    kind: str = "text"  # text / table / heading
    text: str = ""
    locator: dict[str, Any] = Field(default_factory=dict)  # page, block, offset, sheet, rows…


class DocumentChunk(BaseModel):
    id: str
    revision_id: str
    document_id: str
    workspace_id: WorkspaceId
    revision: int
    ordinal: int
    title: str = ""
    body: str
    text_hash: str
    locator: dict[str, Any] = Field(default_factory=dict)
    published: bool = False


class IndexDirectorySize(BaseModel):
    files: int = 0
    bytes: int = 0


class IndexScope(BaseModel):
    files: int = 0
    bytes: int = 0
    excluded_files: int = 0
    excluded_bytes: int = 0
    directories: list[str] = Field(default_factory=list)
    directory_sizes: dict[str, IndexDirectorySize] = Field(default_factory=dict)
    excluded_directory_sizes: dict[str, IndexDirectorySize] = Field(default_factory=dict)
    truncated: bool = False


class IndexPolicy(BaseModel):
    version: int = 0
    paused: bool = False
    excluded_directories: list[str] = Field(default_factory=list)
    scope_confirmed: bool = False


def excluded_path(policy: IndexPolicy, path: str) -> bool:
    return any(path == directory or path.startswith(directory + "/") for directory in policy.excluded_directories)


class IndexPublication(BaseModel):
    """每个工作区一份发布指针；generation 在每次成功 FTS 发布时递增。

    向量侧：embedding_config 隔离索引空间；vector_generation／vector_table_version
    对齐已写入 LanceDB 的代次与表版本，查询固定该表版本。
    """
    workspace_id: WorkspaceId
    generation: int = 0
    status: str = "idle"  # 全文扫描和发布；语义状态由独立操作与发布指针读回
    active_operation_id: Optional[str] = None
    updated_at: datetime = Field(default_factory=utc_now)
    last_error: Optional[str] = None
    embedding_config: Optional[str] = EMBEDDING_CONFIG_FINGERPRINT
    vector_generation: Optional[int] = None
    vector_table_version: Optional[int] = None
    semantic_operation_id: Optional[str] = None
    scan_operation_id: Optional[str] = None
    policy: IndexPolicy = Field(default_factory=IndexPolicy)
    scan: IndexScope = Field(default_factory=IndexScope)
    scope_review_required: bool = False


class SemanticIndexState(StrEnum):
    NOT_INSTALLED = "not_installed"
    EMPTY = "empty"
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    PAUSED = "paused"
    BLOCKED = "blocked"
    FAILED = "failed"


class SemanticIndexSummary(BaseModel):
    state: SemanticIndexState = SemanticIndexState.NOT_INSTALLED
    operation_id: str | None = None
    phase: str | None = None
    progress: OperationProgress | None = None
    error: str | None = None
    published_version: int | None = None


class WorkspaceIndexSummary(BaseModel):
    workspace_id: WorkspaceId
    total: int = 0
    searchable: int = 0
    pending: int = 0
    parsing: int = 0
    pending_component: int = 0
    ocr_pending: int = 0
    ocr_failed: int = 0
    failed: int = 0
    withdrawn: int = 0
    truncated_scan: bool = False
    active_operation_id: Optional[str] = None
    publication_generation: int = 0
    vector_generation: Optional[int] = None
    embedding_config: Optional[str] = None
    semantic_ready: bool = False
    semantic: SemanticIndexSummary = Field(default_factory=SemanticIndexSummary)
    excluded: int = 0
    status: str = "idle"
    last_error: Optional[str] = None
    folder_available: bool = True
    policy: IndexPolicy = Field(default_factory=IndexPolicy)
    scan: IndexScope = Field(default_factory=IndexScope)
    scope_review_required: bool = False


class DocumentLocator(BaseModel):
    page: int | None = None
    region: int | None = None
    box: list[list[float]] | None = None
    ocr_score: float | None = None
    slide: int | None = None
    block_ordinal: int | None = None
    block: int | None = None
    table: int | None = None
    heading: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    sheet: str | None = None
    cell_range: str | None = None
    rows: list[int] | None = None
    column_start: int | None = None
