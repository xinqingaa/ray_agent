"""工作区检索端口：范围固定为一个工作区，接入记忆、会话摘要与文件片段。

写入索引的方法接收调用方的写事务，条目变更与索引在同一事务提交；查询自己打开只读事务。
语义组件可用时以 RRF 融合 FTS 与向量结果；缺失或失败时全文检索照常。
"""
import logging
from typing import Callable, Optional, Sequence

from app.application.errors.exceptions import BadRequestError
from app.domain.models.document_knowledge import DocumentChunk
from app.domain.models.retrieval import (
    SEARCH_HIT_LIMIT,
    SearchExecution,
    SearchHit,
    SearchQuery,
    SearchSourceType,
)
from app.domain.models.semantic_index import (
    RRF_K,
    VECTOR_SEARCH_LIMIT,
)
from app.domain.models.session_summary_record import SessionSummaryRecord, SummaryState
from app.domain.models.workspace_memory import MemoryEntry, MemoryStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.rrf import rrf_fuse_hits

logger = logging.getLogger(__name__)

SEARCHABLE_SOURCES = (
    SearchSourceType.MEMORY, SearchSourceType.SESSION_SUMMARY, SearchSourceType.DOCUMENT_CHUNK,
)


def checked_sources(source_types: Optional[Sequence[SearchSourceType | str]]) -> list[SearchSourceType]:
    """校验来源类型：未指定为全部可检索来源；未知类型拒绝，而不是静默返回空。"""
    if not source_types:
        return list(SEARCHABLE_SOURCES)
    result: list[SearchSourceType] = []
    for item in source_types:
        try:
            source = SearchSourceType(item)
        except ValueError as error:
            raise BadRequestError(f"未知的检索来源：{item}") from error
        if source not in SEARCHABLE_SOURCES:
            raise BadRequestError(f"不支持的检索来源：{source.value}")
        if source not in result:
            result.append(source)
    return result


class RetrievalService:

    def __init__(
            self, uow_factory: Callable[[], IUnitOfWork],
            read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None,
            *, semantic: Optional[object] = None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory
        self._semantic = semantic  # SemanticIndexService；可选，避免循环装配
        self._visible_documents: Callable | None = None

    def bind_semantic(self, semantic) -> None:
        self._semantic = semantic

    def bind_documents(self, visible: Callable) -> None:
        self._visible_documents = visible

    # ---- 查询 ----

    async def search(
            self, workspace_id: str, query: str, source_types: Optional[Sequence[SearchSourceType | str]] = None,
            *, limit: int = SEARCH_HIT_LIMIT, match_any: bool = False,
    ) -> list[SearchHit]:
        hits, _ = await self.search_with_execution(workspace_id, query, source_types, limit=limit, match_any=match_any)
        return hits

    async def search_with_execution(
            self, workspace_id: str, query: str, source_types: Optional[Sequence[SearchSourceType | str]] = None,
            *, limit: int = SEARCH_HIT_LIMIT, match_any: bool = False,
    ) -> tuple[list[SearchHit], SearchExecution]:
        text = (query or "").strip()
        if not text:
            raise BadRequestError("检索词不能为空")
        sources = checked_sources(source_types)
        request = SearchQuery(workspace_id=workspace_id, query=text[:500], source_types=sources,
                              limit=max(1, min(limit, 100)), match_any=match_any)
        want_documents = SearchSourceType.DOCUMENT_CHUNK in sources

        async with self._read_uow_factory() as uow:
            hits = await uow.search.search(request)
            if not hits and not match_any:
                hits = await uow.search.search(request.model_copy(update={"match_any": True}))
            pub = await uow.document.get_publication(workspace_id) if want_documents else None

        hits = await self._current_hits(workspace_id, hits)
        for hit in hits:
            hit.payload["match_kind"] = "full_text"
        lexical = hits[:request.limit]
        if not want_documents:
            return lexical, SearchExecution(reason="source_scope")
        try:
            config = await self._semantic.active_config() if self._semantic else None
            if config is None:
                return lexical, SearchExecution(reason="component_unavailable")
            if (pub is None or pub.embedding_config != config or pub.vector_generation != pub.generation
                    or pub.vector_table_version is None or pub.generation <= 0):
                return lexical, SearchExecution(reason="index_pending")
            rows = await self._semantic.query(
                workspace_id, config, request.query, version=pub.vector_table_version,
                generation=pub.generation, limit=VECTOR_SEARCH_LIMIT,
            )
            if rows is None:
                return await self._current_hits(workspace_id, lexical), SearchExecution(reason="component_unavailable")
        except Exception:
            logger.warning("向量检索失败，回退全文 workspace=%s", workspace_id, exc_info=True)
            return await self._current_hits(workspace_id, lexical), SearchExecution(reason="semantic_error")

        vector_hits = await self._vector_hits(workspace_id, rows)
        # 词法结果跨过了异步向量计算，返回前重核对同期发生的撤回。
        hits = await self._current_hits(workspace_id, hits)
        if not vector_hits:
            return hits[:request.limit], SearchExecution(mode="hybrid")

        # 只对文件片段做 RRF；记忆／摘要保持词法结果并与融合结果合并去重
        lex_docs = [h for h in hits if h.source_type is SearchSourceType.DOCUMENT_CHUNK]
        other = [h for h in hits if h.source_type is not SearchSourceType.DOCUMENT_CHUNK]
        fused_docs = rrf_fuse_hits(lex_docs, vector_hits, k=RRF_K, limit=request.limit)
        # 其他来源按原序插到前面（常驻记忆优先体感），再补文件
        merged: list[SearchHit] = []
        seen = set()
        for hit in other + fused_docs:
            key = (hit.source_type, hit.source_id)
            if key in seen:
                continue
            seen.add(key)
            merged.append(hit)
            if len(merged) >= request.limit:
                break
        return merged, SearchExecution(mode="hybrid")

    async def _current_hits(self, workspace_id: str, hits: list[SearchHit]) -> list[SearchHit]:
        return await self._visible_documents(workspace_id, hits) if self._visible_documents else hits

    async def present_hits(self, workspace_id: str, hits: list[SearchHit]) -> list[SearchHit]:
        """用当前对话标题呈现摘要，包括改名或旧版索引写入的摘要。"""
        if not any(hit.source_type is SearchSourceType.SESSION_SUMMARY for hit in hits):
            return hits
        shown = []
        async with self._read_uow_factory() as uow:
            for hit in hits:
                if hit.source_type is SearchSourceType.SESSION_SUMMARY:
                    session = await uow.session.get_by_id(hit.source_id)
                    if not session or session.workspace_id != workspace_id or not session.participate_in_memory:
                        continue
                    payload = {**hit.payload}
                    if session.latest_message_at:
                        payload["source_at"] = session.latest_message_at.isoformat()
                    hit = hit.model_copy(update={"title": session.title or "会话摘要", "payload": payload})
                shown.append(hit)
        return shown

    async def _vector_hits(self, workspace_id: str, rows: list[dict]) -> list[SearchHit]:
        hits = []
        async with self._read_uow_factory() as uow:
            for rank, row in enumerate(rows):
                chunk = await uow.document.get_chunk(row["chunk_id"])
                if (chunk is None or not chunk.published or chunk.workspace_id != workspace_id
                        or chunk.revision_id != row["revision_id"] or chunk.revision != row["revision"]
                        or chunk.text_hash != row["text_hash"]):
                    continue
                distance = float(row.get("_distance", rank))
                hits.append(SearchHit(
                    source_type=SearchSourceType.DOCUMENT_CHUNK,
                    source_id=chunk.id,
                    source_version=chunk.revision,
                    title=chunk.title,
                    snippet=chunk.body[:400],
                    score=1.0 / (1.0 + max(distance, 0.0)),
                    payload={
                        "document_id": chunk.document_id, "revision_id": chunk.revision_id,
                        "revision": chunk.revision, "locator": dict(chunk.locator),
                        "ordinal": chunk.ordinal, "match_kind": "semantic",
                    },
                ))
        return await self._current_hits(workspace_id, hits)

    # ---- 索引写入（在调用方事务内） ----

    async def index_memory(self, uow: IUnitOfWork, entry: MemoryEntry) -> None:
        """活动条目进入索引；候选、替代与撤回的条目不参与召回，从索引移除。"""
        if entry.status is not MemoryStatus.ACTIVE:
            await self.remove_memory(uow, entry)
            return
        await uow.search.upsert(
            workspace_id=entry.workspace_id, source_type=SearchSourceType.MEMORY, source_id=entry.id,
            source_version=entry.version, title=entry.memory_type.value, body=entry.content,
            payload={"certainty": entry.certainty.value, "memory_type": entry.memory_type.value,
                     "origin": entry.origin.value, "pinned": entry.pinned},
        )

    async def remove_memory(self, uow: IUnitOfWork, entry: MemoryEntry) -> None:
        await uow.search.remove(workspace_id=entry.workspace_id, source_type=SearchSourceType.MEMORY,
                                source_id=entry.id)

    async def index_summary(self, uow: IUnitOfWork, record: SessionSummaryRecord) -> None:
        """只有就绪且有正文的会话摘要进入索引；生成中或失败时保留此前索引。"""
        if not record.workspace_id or record.state is not SummaryState.READY or not record.body.strip():
            return
        session = await uow.session.get_by_id(record.session_id)
        if session is None or session.workspace_id != record.workspace_id or not session.participate_in_memory:
            await self.remove_summary(uow, record.workspace_id, record.session_id)
            return
        await uow.search.upsert(
            workspace_id=record.workspace_id, source_type=SearchSourceType.SESSION_SUMMARY,
            source_id=record.session_id, source_version=record.generation, title="会话摘要", body=record.body,
            payload={"session_id": record.session_id, "source_seq": record.source_seq, "stale": False,
                     "memory_access_version": session.memory_access_version},
        )

    async def remove_summary(self, uow: IUnitOfWork, workspace_id: str, session_id: str) -> None:
        await uow.search.remove(workspace_id=workspace_id, source_type=SearchSourceType.SESSION_SUMMARY,
                                source_id=session_id)

    async def index_document_chunk(self, uow: IUnitOfWork, chunk: DocumentChunk, *, relative_path: str) -> None:
        """已发布的文件片段进入 FTS；source_id 为 chunk id，payload 带文档修订与定位。"""
        await uow.search.upsert(
            workspace_id=chunk.workspace_id, source_type=SearchSourceType.DOCUMENT_CHUNK,
            source_id=chunk.id, source_version=chunk.revision, title=chunk.title or relative_path,
            body=chunk.body,
            payload={
                "document_id": chunk.document_id, "revision_id": chunk.revision_id,
                "revision": chunk.revision, "relative_path": relative_path,
                "locator": dict(chunk.locator), "ordinal": chunk.ordinal, "stale": False,
            },
        )

    async def remove_document_chunk(self, uow: IUnitOfWork, workspace_id: str, chunk_id: str) -> None:
        await uow.search.remove(workspace_id=workspace_id, source_type=SearchSourceType.DOCUMENT_CHUNK,
                                source_id=chunk_id)
