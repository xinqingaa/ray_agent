"""全文检索端口：search_documents + FTS5；中文分词由调用方写入 tokenized 字段。"""
import json
from typing import Optional, Sequence
from uuid import uuid4

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.clock import utc_now
from app.domain.models.retrieval import SearchDocument, SearchHit, SearchQuery, SearchSourceType
from app.domain.services.chinese_tokenize import fts_match_query, tokenize
from app.infrastructure.models.search_document import SearchDocumentModel


class DBSearchRepository:
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def upsert(
            self, *, workspace_id: str, source_type: SearchSourceType, source_id: str,
            source_version: int, title: str, body: str, payload: Optional[dict] = None,
    ) -> SearchDocument:
        tokenized = tokenize(f"{title}\n{body}")
        existing = (await self.db_session.execute(
            select(SearchDocumentModel).where(
                SearchDocumentModel.workspace_id == workspace_id,
                SearchDocumentModel.source_type == source_type.value,
                SearchDocumentModel.source_id == source_id,
            )
        )).scalar_one_or_none()
        if existing is None:
            doc = SearchDocument(
                id=str(uuid4()), workspace_id=workspace_id, source_type=source_type,
                source_id=source_id, source_version=source_version, title=title, body=body,
                tokenized=tokenized, payload=dict(payload or {}), updated_at=utc_now(),
            )
            self.db_session.add(SearchDocumentModel.from_domain(doc))
            await self.db_session.flush()
            await self._fts_insert(doc)
            return doc
        existing.source_version = source_version
        existing.title = title
        existing.body = body
        existing.tokenized = tokenized
        existing.payload = dict(payload or {})
        existing.updated_at = utc_now()
        await self.db_session.flush()
        doc = existing.to_domain()
        await self._fts_delete(doc.id)
        await self._fts_insert(doc)
        return doc

    async def remove(self, *, workspace_id: str, source_type: SearchSourceType, source_id: str) -> None:
        existing = (await self.db_session.execute(
            select(SearchDocumentModel).where(
                SearchDocumentModel.workspace_id == workspace_id,
                SearchDocumentModel.source_type == source_type.value,
                SearchDocumentModel.source_id == source_id,
            )
        )).scalar_one_or_none()
        if existing is None:
            return
        await self._fts_delete(existing.id)
        await self.db_session.delete(existing)
        await self.db_session.flush()

    async def delete_workspace(self, workspace_id: str) -> None:
        rows = (await self.db_session.execute(
            select(SearchDocumentModel.id).where(SearchDocumentModel.workspace_id == workspace_id)
        )).scalars().all()
        for doc_id in rows:
            await self._fts_delete(doc_id)
        await self.db_session.execute(
            delete(SearchDocumentModel).where(SearchDocumentModel.workspace_id == workspace_id))

    async def search(self, query: SearchQuery) -> list[SearchHit]:
        match = fts_match_query(query.query, any_term=query.match_any)
        if not match:
            return []
        types = [t.value for t in query.source_types] or [
            SearchSourceType.MEMORY.value, SearchSourceType.SESSION_SUMMARY.value,
        ]
        # FTS5 在工作区范围内匹配；排名用 bm25（越低越好，取负作分数）
        sql = text(
            """
            SELECT d.id, d.workspace_id, d.source_type, d.source_id, d.source_version,
                   d.title, d.body, d.payload, bm25(search_documents_fts) AS rank
            FROM search_documents_fts
            JOIN search_documents d ON d.id = search_documents_fts.doc_id
            WHERE search_documents_fts MATCH :match
              AND d.workspace_id = :workspace_id
              AND d.source_type IN :types
            ORDER BY rank
            LIMIT :limit
            """
        )
        # aiosqlite/SQLAlchemy 对 IN :types 的绑定不友好，改用动态占位
        placeholders = ", ".join(f":t{i}" for i in range(len(types)))
        sql = text(
            f"""
            SELECT d.source_type, d.source_id, d.source_version, d.title, d.body, d.payload,
                   bm25(search_documents_fts) AS rank
            FROM search_documents_fts
            JOIN search_documents d ON d.id = search_documents_fts.doc_id
            WHERE search_documents_fts MATCH :match
              AND d.workspace_id = :workspace_id
              AND d.source_type IN ({placeholders})
            ORDER BY rank
            LIMIT :limit
            """
        )
        params = {
            "match": match,
            "workspace_id": query.workspace_id,
            "limit": query.limit,
            **{f"t{i}": value for i, value in enumerate(types)},
        }
        result = await self.db_session.execute(sql, params)
        hits: list[SearchHit] = []
        for row in result.mappings().all():
            body = row["body"] or ""
            snippet = body if len(body) <= 400 else body[:400] + "…"
            payload = row["payload"] or {}
            if isinstance(payload, str):  # 原生 SQL 读出的 JSON 列是文本
                payload = json.loads(payload)
            hits.append(SearchHit(
                source_type=SearchSourceType(row["source_type"]),
                source_id=row["source_id"],
                source_version=int(row["source_version"]),
                title=row["title"] or "",
                snippet=snippet,
                score=-float(row["rank"] or 0),
                certainty=payload.get("certainty"),
                stale=bool(payload.get("stale")),
                payload=dict(payload),
            ))
        return hits

    async def _fts_insert(self, doc: SearchDocument) -> None:
        # title/body 列写入已分词文本，便于 unicode61 按空格切词
        await self.db_session.execute(
            text(
                "INSERT INTO search_documents_fts(doc_id, workspace_id, source_type, title, body) "
                "VALUES (:doc_id, :workspace_id, :source_type, :title, :body)"
            ),
            {
                "doc_id": doc.id,
                "workspace_id": doc.workspace_id,
                "source_type": doc.source_type.value,
                "title": tokenize(doc.title),
                "body": doc.tokenized,
            },
        )

    async def _fts_delete(self, doc_id: str) -> None:
        await self.db_session.execute(
            text("DELETE FROM search_documents_fts WHERE doc_id = :doc_id"),
            {"doc_id": doc_id},
        )
