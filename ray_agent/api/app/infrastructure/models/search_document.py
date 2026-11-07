"""全文检索文档元数据 ORM；FTS5 虚表由检索仓库直接维护。"""
from datetime import datetime
from typing import Any, Dict

from sqlalchemy import Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.retrieval import SearchDocument, SearchSourceType


class SearchDocumentModel(Base):
    __tablename__ = "search_documents"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tokenized: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, doc: SearchDocument) -> "SearchDocumentModel":
        return cls(
            id=doc.id, workspace_id=doc.workspace_id, source_type=doc.source_type.value,
            source_id=doc.source_id, source_version=doc.source_version, title=doc.title,
            body=doc.body, tokenized=doc.tokenized, payload=dict(doc.payload or {}),
            updated_at=doc.updated_at,
        )

    def to_domain(self) -> SearchDocument:
        return SearchDocument(
            id=self.id, workspace_id=self.workspace_id, source_type=SearchSourceType(self.source_type),
            source_id=self.source_id, source_version=self.source_version, title=self.title,
            body=self.body, tokenized=self.tokenized, payload=dict(self.payload or {}),
            updated_at=self.updated_at,
        )
