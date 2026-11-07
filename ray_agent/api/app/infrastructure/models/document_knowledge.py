"""文档知识 ORM。"""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.document_knowledge import (
    ContentBlock,
    DocumentChunk,
    DocumentFormat,
    DocumentIndexStatus,
    DocumentRecord,
    DocumentRevision,
    IndexPublication,
)


class DocumentModel(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, doc: DocumentRecord) -> "DocumentModel":
        return cls(
            id=doc.id, workspace_id=doc.workspace_id, relative_path=doc.relative_path,
            current_revision=doc.current_revision, status=doc.status.value, format=doc.format.value,
            created_at=doc.created_at, updated_at=doc.updated_at,
        )

    def to_domain(self) -> DocumentRecord:
        return DocumentRecord(
            id=self.id, workspace_id=self.workspace_id, relative_path=self.relative_path,
            current_revision=self.current_revision, status=DocumentIndexStatus(self.status),
            format=DocumentFormat(self.format), created_at=self.created_at, updated_at=self.updated_at,
        )


class DocumentRevisionModel(Base):
    __tablename__ = "document_revisions"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    modified_ns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)
    parse_config: Mapped[str] = mapped_column(String(64), nullable=False)
    chunk_config: Mapped[str] = mapped_column(String(64), nullable=False)
    staging_object_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    component_needed: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    published_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    @classmethod
    def from_domain(cls, rev: DocumentRevision) -> "DocumentRevisionModel":
        return cls(**{**rev.model_dump(mode="python"), "status": rev.status.value, "format": rev.format.value})

    def to_domain(self) -> DocumentRevision:
        return DocumentRevision(
            id=self.id, document_id=self.document_id, workspace_id=self.workspace_id,
            revision=self.revision, relative_path=self.relative_path, content_hash=self.content_hash,
            size=self.size, modified_ns=self.modified_ns, status=DocumentIndexStatus(self.status),
            format=DocumentFormat(self.format), parse_config=self.parse_config,
            chunk_config=self.chunk_config, staging_object_id=self.staging_object_id,
            error_message=self.error_message, component_needed=self.component_needed,
            created_at=self.created_at, updated_at=self.updated_at, published_at=self.published_at,
        )


class ContentBlockModel(Base):
    __tablename__ = "content_blocks"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    locator: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    @classmethod
    def from_domain(cls, block: ContentBlock) -> "ContentBlockModel":
        return cls(**block.model_dump(mode="python"))

    def to_domain(self) -> ContentBlock:
        return ContentBlock(
            id=self.id, revision_id=self.revision_id, workspace_id=self.workspace_id,
            ordinal=self.ordinal, kind=self.kind, text=self.text, locator=dict(self.locator or {}),
        )


class DocumentChunkModel(Base):
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision_id: Mapped[str] = mapped_column(String(128), nullable=False)
    document_id: Mapped[str] = mapped_column(String(128), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    locator: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    @classmethod
    def from_domain(cls, chunk: DocumentChunk) -> "DocumentChunkModel":
        return cls(**chunk.model_dump(mode="python"))

    def to_domain(self) -> DocumentChunk:
        return DocumentChunk(
            id=self.id, revision_id=self.revision_id, document_id=self.document_id,
            workspace_id=self.workspace_id, revision=self.revision, ordinal=self.ordinal,
            title=self.title, body=self.body, text_hash=self.text_hash,
            locator=dict(self.locator or {}), published=self.published,
        )


class IndexPublicationModel(Base):
    __tablename__ = "index_publications"

    workspace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    active_operation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding_config: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    vector_generation: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vector_table_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    semantic_operation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    @classmethod
    def from_domain(cls, pub: IndexPublication) -> "IndexPublicationModel":
        return cls(**pub.model_dump(mode="python"))

    def to_domain(self) -> IndexPublication:
        return IndexPublication(
            workspace_id=self.workspace_id, generation=self.generation, status=self.status,
            active_operation_id=self.active_operation_id, updated_at=self.updated_at,
            last_error=self.last_error, embedding_config=self.embedding_config,
            vector_generation=self.vector_generation, vector_table_version=self.vector_table_version,
            semantic_operation_id=self.semantic_operation_id,
        )
