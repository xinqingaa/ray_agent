"""文档知识仓库协议。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional, Sequence

from app.domain.models.document_knowledge import (
    ContentBlock,
    DocumentChunk,
    DocumentIndexStatus,
    DocumentRecord,
    DocumentRevision,
    IndexPublication,
    WorkspaceIndexSummary,
)


class DocumentRepository(ABC):
    @abstractmethod
    async def get(self, document_id: str) -> Optional[DocumentRecord]: ...

    @abstractmethod
    async def get_by_path(self, workspace_id: str, relative_path: str) -> Optional[DocumentRecord]: ...

    @abstractmethod
    async def save(self, document: DocumentRecord) -> None: ...

    @abstractmethod
    async def list_workspace(self, workspace_id: str) -> list[DocumentRecord]: ...

    @abstractmethod
    async def add_revision(self, revision: DocumentRevision) -> None: ...

    @abstractmethod
    async def get_revision(self, revision_id: str) -> Optional[DocumentRevision]: ...

    @abstractmethod
    async def get_revision_by_number(self, document_id: str, revision: int) -> Optional[DocumentRevision]: ...

    @abstractmethod
    async def save_revision(self, revision: DocumentRevision) -> None: ...

    @abstractmethod
    async def list_revisions_by_status(
            self, workspace_id: str, statuses: Sequence[DocumentIndexStatus], *, limit: int = 50,
    ) -> list[DocumentRevision]: ...

    @abstractmethod
    async def replace_blocks(self, revision_id: str, blocks: Sequence[ContentBlock]) -> None: ...

    @abstractmethod
    async def list_blocks(self, revision_id: str) -> list[ContentBlock]: ...

    @abstractmethod
    async def replace_chunks(self, revision_id: str, chunks: Sequence[DocumentChunk]) -> None: ...

    @abstractmethod
    async def list_chunks(self, revision_id: str, *, published_only: bool = False) -> list[DocumentChunk]: ...

    @abstractmethod
    async def get_chunk(self, chunk_id: str) -> Optional[DocumentChunk]: ...

    @abstractmethod
    async def mark_chunks_published(self, revision_id: str, published: bool) -> None: ...

    @abstractmethod
    async def unpublish_document(self, document_id: str) -> list[str]:
        """撤回文档全部已发布片段，返回被撤回的 chunk id。"""
        ...

    @abstractmethod
    async def get_publication(self, workspace_id: str) -> Optional[IndexPublication]: ...

    @abstractmethod
    async def save_publication(self, publication: IndexPublication) -> None: ...

    @abstractmethod
    async def summary(self, workspace_id: str) -> WorkspaceIndexSummary: ...

    @abstractmethod
    async def delete_workspace(self, workspace_id: str) -> None: ...
