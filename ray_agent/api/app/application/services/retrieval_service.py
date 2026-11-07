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
    SearchHit,
    SearchQuery,
    SearchSourceType,
)
from app.domain.models.semantic_index import (
    EMBEDDING_COMPONENT_ID,
    EMBEDDING_CONFIG_FINGERPRINT,
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

    def bind_semantic(self, semantic) -> None:
        self._semantic = semantic

    # ---- 查询 ----

    async def search(
            self, workspace_id: str, query: str, source_types: Optional[Sequence[SearchSourceType | str]] = None,
            *, limit: int = SEARCH_HIT_LIMIT, match_any: bool = False,
    ) -> list[SearchHit]:
        """在固定工作区内检索。默认全文；语义可用且含文件片段时与向量 RRF 融合。"""
        text = (query or "").strip()
        if not text:
            raise BadRequestError("检索词不能为空")
        sources = checked_sources(source_types)
        request = SearchQuery(workspace_id=workspace_id, query=text[:500], source_types=sources,
                              limit=max(1, min(limit, 100)), match_any=match_any)

        # 短只读事务：FTS 候选 + 发布指针 + 已发布 chunk 身份
        async with self._read_uow_factory() as uow:
            hits = await uow.search.search(request)
            if not hits and not match_any:
                hits = await uow.search.search(request.model_copy(update={"match_any": True}))
            pub = await uow.document.get_publication(workspace_id)
            published_ids: set[str] | None = None
            vector_version = None
            embedding_config = EMBEDDING_CONFIG_FINGERPRINT
            vector_ready = False
            if SearchSourceType.DOCUMENT_CHUNK in sources and pub is not None:
                embedding_config = pub.embedding_config or EMBEDDING_CONFIG_FINGERPRINT
                if (pub.vector_generation is not None and pub.vector_table_version is not None
                        and pub.vector_generation == pub.generation and pub.generation > 0):
                    vector_ready = True
                    vector_version = pub.vector_table_version
                    chunks = await uow.document.list_published_chunks(workspace_id)
                    published_ids = {chunk.id for chunk in chunks}
                    # 预取 chunk 元数据供向量命中转 SearchHit
                    chunk_by_id = {chunk.id: chunk for chunk in chunks}
                else:
                    chunk_by_id = {}
            else:
                chunk_by_id = {}

        want_vector = (
            vector_ready and self._semantic is not None
            and SearchSourceType.DOCUMENT_CHUNK in sources
        )
        if not want_vector:
            return hits[:request.limit]

        vector_hits = await self._vector_hits(
            workspace_id, text, limit=VECTOR_SEARCH_LIMIT, version=vector_version,
            embedding_config=embedding_config, allowed=published_ids, chunk_by_id=chunk_by_id,
        )
        if not vector_hits:
            return hits[:request.limit]

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
        return merged

    async def _vector_hits(
            self, workspace_id: str, query: str, *, limit: int, version: int | None,
            embedding_config: str, allowed: set[str] | None, chunk_by_id: dict,
    ) -> list[SearchHit]:
        try:
            embedder = await self._semantic._embedder_or_none()  # noqa: SLF001
            if embedder is None:
                return []
            vector = embedder.embed_query(query)
            store = self._semantic.store_for(workspace_id, embedding_config)
            rows = store.search(vector, limit=limit, version=version, allowed_chunk_ids=allowed)
        except Exception as error:  # noqa: BLE001 — 语义失败不阻断全文
            logger.warning("向量检索失败，回退全文: %s", error)
            return []
        hits: list[SearchHit] = []
        for rank, row in enumerate(rows):
            chunk_id = row.get("chunk_id")
            chunk = chunk_by_id.get(chunk_id)
            if chunk is None:
                continue
            # 距离转弱分数：仅用于排序占位，最终以 RRF 为准
            distance = float(row.get("_distance", rank))
            score = 1.0 / (1.0 + max(distance, 0.0))
            hits.append(SearchHit(
                source_type=SearchSourceType.DOCUMENT_CHUNK,
                source_id=chunk.id,
                source_version=chunk.revision,
                title=chunk.title,
                snippet=chunk.body[:400],
                score=score,
                stale=False,
                payload={
                    "document_id": chunk.document_id, "revision_id": chunk.revision_id,
                    "revision": chunk.revision, "locator": dict(chunk.locator),
                    "ordinal": chunk.ordinal, "stale": False,
                },
            ))
        return hits

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
        await uow.search.upsert(
            workspace_id=record.workspace_id, source_type=SearchSourceType.SESSION_SUMMARY,
            source_id=record.session_id, source_version=record.generation, title="会话摘要", body=record.body,
            payload={"session_id": record.session_id, "source_seq": record.source_seq, "stale": False},
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
