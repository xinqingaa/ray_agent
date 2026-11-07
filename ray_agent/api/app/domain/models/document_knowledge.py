"""工作区文档知识：登记、修订、结构块、片段与索引发布。

索引发布与权威可见状态在 SQLite；片段经检索端口写入 FTS。向量与 OCR 留给 P7。
"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import WorkspaceId

# 解析／切分配置指纹：任一变化需重建派生索引；P7 Embedding 配置另起空间
PARSE_CONFIG_FINGERPRINT = "p6-parse-v1"
CHUNK_CONFIG_FINGERPRINT = "p6-chunk-v1"

# 单文件解析与入库上限（字节／字符）；默认值同步参数页
DOCUMENT_PARSE_MAX_BYTES = 32 * 1024 * 1024
DOCUMENT_CHUNK_CHARS = 800
DOCUMENT_CHUNK_OVERLAP = 80
DOCUMENT_TABLE_ROWS_PER_CHUNK = 40
DOCUMENT_INDEX_SCAN_BATCH = 200


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


class DocumentRecord(BaseModel):
    id: str
    workspace_id: WorkspaceId
    relative_path: str
    current_revision: int = 0
    status: DocumentIndexStatus = DocumentIndexStatus.REGISTERED
    format: DocumentFormat = DocumentFormat.UNSUPPORTED
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class DocumentRevision(BaseModel):
    id: str
    document_id: str
    workspace_id: WorkspaceId
    revision: int
    relative_path: str
    content_hash: str
    size: int = 0
    modified_ns: int = 0
    status: DocumentIndexStatus = DocumentIndexStatus.PENDING_PARSE
    format: DocumentFormat = DocumentFormat.UNSUPPORTED
    parse_config: str = PARSE_CONFIG_FINGERPRINT
    chunk_config: str = CHUNK_CONFIG_FINGERPRINT
    staging_object_id: Optional[str] = None  # 解析产物暂存；发布成功后仍可保留供核对
    error_message: Optional[str] = None
    component_needed: Optional[str] = None  # 如 ocr；P7 安装后重试
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


class IndexPublication(BaseModel):
    """每个工作区一份发布指针；generation 在每次成功发布时递增。"""
    workspace_id: WorkspaceId
    generation: int = 0
    status: str = "idle"  # idle / publishing / failed
    active_operation_id: Optional[str] = None
    updated_at: datetime = Field(default_factory=utc_now)
    last_error: Optional[str] = None


class WorkspaceIndexSummary(BaseModel):
    workspace_id: WorkspaceId
    total: int = 0
    searchable: int = 0
    pending: int = 0
    parsing: int = 0
    pending_component: int = 0
    failed: int = 0
    withdrawn: int = 0
    truncated_scan: bool = False
    active_operation_id: Optional[str] = None
    publication_generation: int = 0
