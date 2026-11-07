"""文档知识仓库：权威元数据与片段；FTS 发布仍走 search 端口。"""
from typing import Optional, Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.document_knowledge import (
    ContentBlock,
    DocumentChunk,
    DocumentIndexStatus,
    DocumentRecord,
    DocumentRevision,
    IndexPublication,
    WorkspaceIndexSummary,
)
from app.domain.repositories.document_repository import DocumentRepository
from app.infrastructure.models.document_knowledge import (
    ContentBlockModel,
    DocumentChunkModel,
    DocumentModel,
    DocumentRevisionModel,
    IndexPublicationModel,
)


class DBDocumentRepository(DocumentRepository):
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def get(self, document_id: str) -> Optional[DocumentRecord]:
        row = await self.db_session.get(DocumentModel, document_id)
        return row.to_domain() if row else None

    async def get_by_path(self, workspace_id: str, relative_path: str) -> Optional[DocumentRecord]:
        row = (await self.db_session.execute(
            select(DocumentModel).where(
                DocumentModel.workspace_id == workspace_id,
                DocumentModel.relative_path == relative_path,
            )
        )).scalar_one_or_none()
        return row.to_domain() if row else None

    async def save(self, document: DocumentRecord) -> None:
        existing = await self.db_session.get(DocumentModel, document.id)
        if existing is None:
            self.db_session.add(DocumentModel.from_domain(document))
        else:
            existing.relative_path = document.relative_path
            existing.current_revision = document.current_revision
            existing.status = document.status.value
            existing.format = document.format.value
            existing.updated_at = document.updated_at
        await self.db_session.flush()

    async def list_workspace(self, workspace_id: str) -> list[DocumentRecord]:
        rows = (await self.db_session.execute(
            select(DocumentModel).where(DocumentModel.workspace_id == workspace_id)
            .order_by(DocumentModel.relative_path)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def add_revision(self, revision: DocumentRevision) -> None:
        self.db_session.add(DocumentRevisionModel.from_domain(revision))
        await self.db_session.flush()

    async def get_revision(self, revision_id: str) -> Optional[DocumentRevision]:
        row = await self.db_session.get(DocumentRevisionModel, revision_id)
        return row.to_domain() if row else None

    async def get_revision_by_number(self, document_id: str, revision: int) -> Optional[DocumentRevision]:
        row = (await self.db_session.execute(
            select(DocumentRevisionModel).where(
                DocumentRevisionModel.document_id == document_id,
                DocumentRevisionModel.revision == revision,
            )
        )).scalar_one_or_none()
        return row.to_domain() if row else None

    async def save_revision(self, revision: DocumentRevision) -> None:
        existing = await self.db_session.get(DocumentRevisionModel, revision.id)
        if existing is None:
            self.db_session.add(DocumentRevisionModel.from_domain(revision))
        else:
            for field in ("status", "format", "parse_config", "chunk_config", "staging_object_id",
                          "error_message", "component_needed", "updated_at", "published_at",
                          "content_hash", "size", "modified_ns", "relative_path"):
                setattr(existing, field, getattr(revision, field).value
                        if field in ("status", "format") else getattr(revision, field))
        await self.db_session.flush()

    async def list_revisions_by_status(
            self, workspace_id: str, statuses: Sequence[DocumentIndexStatus], *, limit: int = 50,
    ) -> list[DocumentRevision]:
        rows = (await self.db_session.execute(
            select(DocumentRevisionModel).where(
                DocumentRevisionModel.workspace_id == workspace_id,
                DocumentRevisionModel.status.in_([s.value for s in statuses]),
            ).order_by(DocumentRevisionModel.created_at).limit(limit)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def list_pending_component(
            self, *, component: str, limit: int = 500,
    ) -> list[DocumentRevision]:
        rows = (await self.db_session.execute(
            select(DocumentRevisionModel).where(
                DocumentRevisionModel.status == DocumentIndexStatus.PENDING_COMPONENT.value,
                DocumentRevisionModel.component_needed == component,
            ).order_by(DocumentRevisionModel.updated_at).limit(limit)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def list_publication_workspace_ids(self) -> list[str]:
        rows = (await self.db_session.execute(select(IndexPublicationModel.workspace_id))).scalars().all()
        return list(rows)

    async def replace_blocks(self, revision_id: str, blocks: Sequence[ContentBlock]) -> None:
        await self.db_session.execute(delete(ContentBlockModel).where(ContentBlockModel.revision_id == revision_id))
        for block in blocks:
            self.db_session.add(ContentBlockModel.from_domain(block))
        await self.db_session.flush()

    async def list_blocks(self, revision_id: str) -> list[ContentBlock]:
        rows = (await self.db_session.execute(
            select(ContentBlockModel).where(ContentBlockModel.revision_id == revision_id)
            .order_by(ContentBlockModel.ordinal)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def replace_chunks(self, revision_id: str, chunks: Sequence[DocumentChunk]) -> None:
        await self.db_session.execute(delete(DocumentChunkModel).where(DocumentChunkModel.revision_id == revision_id))
        for chunk in chunks:
            self.db_session.add(DocumentChunkModel.from_domain(chunk))
        await self.db_session.flush()

    async def list_chunks(self, revision_id: str, *, published_only: bool = False) -> list[DocumentChunk]:
        stmt = select(DocumentChunkModel).where(DocumentChunkModel.revision_id == revision_id)
        if published_only:
            stmt = stmt.where(DocumentChunkModel.published.is_(True))
        rows = (await self.db_session.execute(stmt.order_by(DocumentChunkModel.ordinal))).scalars().all()
        return [row.to_domain() for row in rows]

    async def get_chunk(self, chunk_id: str) -> Optional[DocumentChunk]:
        row = await self.db_session.get(DocumentChunkModel, chunk_id)
        return row.to_domain() if row else None

    async def mark_chunks_published(self, revision_id: str, published: bool) -> None:
        await self.db_session.execute(
            update(DocumentChunkModel).where(DocumentChunkModel.revision_id == revision_id)
            .values(published=published))
        await self.db_session.flush()

    async def unpublish_document(self, document_id: str) -> list[str]:
        rows = (await self.db_session.execute(
            select(DocumentChunkModel).where(
                DocumentChunkModel.document_id == document_id,
                DocumentChunkModel.published.is_(True),
            )
        )).scalars().all()
        ids = [row.id for row in rows]
        if ids:
            await self.db_session.execute(
                update(DocumentChunkModel).where(DocumentChunkModel.document_id == document_id)
                .values(published=False))
            await self.db_session.flush()
        return ids

    async def get_publication(self, workspace_id: str) -> Optional[IndexPublication]:
        row = await self.db_session.get(IndexPublicationModel, workspace_id)
        return row.to_domain() if row else None

    async def save_publication(self, publication: IndexPublication) -> None:
        existing = await self.db_session.get(IndexPublicationModel, publication.workspace_id)
        if existing is None:
            self.db_session.add(IndexPublicationModel.from_domain(publication))
        else:
            existing.generation = publication.generation
            existing.status = publication.status
            existing.active_operation_id = publication.active_operation_id
            existing.updated_at = publication.updated_at
            existing.last_error = publication.last_error
            existing.embedding_config = publication.embedding_config
            existing.vector_generation = publication.vector_generation
            existing.vector_table_version = publication.vector_table_version
            existing.semantic_operation_id = publication.semantic_operation_id
        await self.db_session.flush()

    async def list_published_chunks(self, workspace_id: str) -> list[DocumentChunk]:
        rows = (await self.db_session.execute(
            select(DocumentChunkModel).where(
                DocumentChunkModel.workspace_id == workspace_id,
                DocumentChunkModel.published.is_(True),
            ).order_by(DocumentChunkModel.document_id, DocumentChunkModel.ordinal)
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def summary(self, workspace_id: str) -> WorkspaceIndexSummary:
        rows = (await self.db_session.execute(
            select(DocumentModel.status, func.count()).where(DocumentModel.workspace_id == workspace_id)
            .group_by(DocumentModel.status)
        )).all()
        counts = {status: count for status, count in rows}
        pub = await self.get_publication(workspace_id)
        pending_statuses = (
            DocumentIndexStatus.REGISTERED, DocumentIndexStatus.PENDING_PARSE,
            DocumentIndexStatus.INDEXING,
        )
        vector_gen = pub.vector_generation if pub else None
        generation = pub.generation if pub else 0
        return WorkspaceIndexSummary(
            workspace_id=workspace_id,
            total=sum(counts.values()),
            searchable=counts.get(DocumentIndexStatus.SEARCHABLE.value, 0),
            pending=sum(counts.get(s.value, 0) for s in pending_statuses),
            parsing=counts.get(DocumentIndexStatus.PARSING.value, 0),
            pending_component=counts.get(DocumentIndexStatus.PENDING_COMPONENT.value, 0),
            failed=counts.get(DocumentIndexStatus.FAILED.value, 0),
            withdrawn=counts.get(DocumentIndexStatus.WITHDRAWN.value, 0),
            active_operation_id=pub.active_operation_id if pub else None,
            publication_generation=generation,
            vector_generation=vector_gen,
            embedding_config=pub.embedding_config if pub else None,
            semantic_ready=bool(vector_gen is not None and vector_gen == generation and generation > 0),
        )

    async def delete_workspace(self, workspace_id: str) -> None:
        await self.db_session.execute(delete(DocumentChunkModel).where(DocumentChunkModel.workspace_id == workspace_id))
        await self.db_session.execute(delete(ContentBlockModel).where(ContentBlockModel.workspace_id == workspace_id))
        await self.db_session.execute(
            delete(DocumentRevisionModel).where(DocumentRevisionModel.workspace_id == workspace_id))
        await self.db_session.execute(delete(DocumentModel).where(DocumentModel.workspace_id == workspace_id))
        await self.db_session.execute(
            delete(IndexPublicationModel).where(IndexPublicationModel.workspace_id == workspace_id))
        await self.db_session.flush()
