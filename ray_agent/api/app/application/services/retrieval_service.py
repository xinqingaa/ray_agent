"""工作区检索端口：范围固定为一个工作区，接入记忆、会话摘要与文件片段。

写入索引的方法接收调用方的写事务，条目变更与索引在同一事务提交；查询自己打开只读事务。
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
from app.domain.models.session_summary_record import SessionSummaryRecord, SummaryState
from app.domain.models.workspace_memory import MemoryEntry, MemoryStatus
from app.domain.repositories.uow import IUnitOfWork

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

    def __init__(self, uow_factory: Callable[[], IUnitOfWork],
                 read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory

    # ---- 查询 ----

    async def search(
            self, workspace_id: str, query: str, source_types: Optional[Sequence[SearchSourceType | str]] = None,
            *, limit: int = SEARCH_HIT_LIMIT, match_any: bool = False,
    ) -> list[SearchHit]:
        """在固定工作区内全文检索。默认所有词都要命中；没有结果且问句有多个词时放宽为任一词命中。"""
        text = (query or "").strip()
        if not text:
            raise BadRequestError("检索词不能为空")
        sources = checked_sources(source_types)
        request = SearchQuery(workspace_id=workspace_id, query=text[:500], source_types=sources,
                              limit=max(1, min(limit, 100)), match_any=match_any)
        async with self._read_uow_factory() as uow:
            hits = await uow.search.search(request)
            if not hits and not match_any:
                hits = await uow.search.search(request.model_copy(update={"match_any": True}))
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
