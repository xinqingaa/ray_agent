"""运行正常结束后的后台任务：会话摘要与自动记忆提炼。

登记发生在运行结束的同一事务里；两类任务都在领取时先提交代次与材料截止位置，模型调用在事务之外，
写回前再次核对：代次或截止位置已变化（重试、更新的任务、会话被设为不参与）的迟到结果直接丢弃，
失败或空结果不覆盖已有摘要、不产生记忆，也不会被表述为已完成。
"""
import logging
import uuid
from typing import Any, Awaitable, Callable

from app.application.services.background_jobs import JobContext
from app.application.services.memory_extractor import MemoryExtractor, ProposedFact
from app.application.services.memory_service import EXTRACTION_MAX_ITEMS, MemoryService
from app.application.services.retrieval_service import RetrievalService
from app.application.services.session_summary import SummaryUnavailable, generate_summary
from app.domain.models.app_config import LLMConfig
from app.domain.models.background_job import BackgroundJob
from app.domain.models.clock import utc_now
from app.domain.models.memory_settings import auto_memory_enabled
from app.domain.models.operation import OperationKind, OperationProgress, OperationScope, OperationScopeKind
from app.domain.models.retrieval import SearchSourceType
from app.domain.models.session_summary_record import SessionSummaryRecord, SummaryState
from app.domain.models.workspace import WorkspaceStatus
from app.domain.models.workspace_memory import ExtractionCommitStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.memory_rules import ExtractionAction, ExtractionDecision

logger = logging.getLogger(__name__)

SIMILAR_LIMIT = 5  # 判定每条候选时参考的相似活动条目数

LLMConfigLoader = Callable[[], Awaitable[LLMConfig]]
SummaryGenerator = Callable[[LLMConfig, dict], Awaitable[dict]]
ExtractorFactory = Callable[[], Awaitable[MemoryExtractor]]


def _scope(workspace_id: str, session_id: str) -> OperationScope:
    return OperationScope(kind=OperationScopeKind.SESSION, session_id=session_id, workspace_id=workspace_id)


async def enqueue_post_run_jobs(uow: IUnitOfWork, memory: MemoryService, session_id: str) -> list[BackgroundJob]:
    """运行正常结束时在同一写事务里登记摘要与提炼任务。

    只有工作区会话且允许参与记忆时才登记：独立对话不写入记忆，设为不参与的会话既不提炼也不生成可检索的摘要。
    提炼还要求工作区开启自动记忆。同一会话同一截止位置重复登记返回已有任务。
    """
    session = await uow.session.get_by_id(session_id)
    if session is None or not session.workspace_id or not session.participate_in_memory:
        return []
    workspace = await uow.workspace.get(session.workspace_id)
    if workspace is None or workspace.status is not WorkspaceStatus.ACTIVE:
        return []
    seq = await uow.event.max_seq(session_id)
    payload = {"workspace_id": session.workspace_id, "session_id": session_id, "source_seq_end": seq}
    jobs: list[BackgroundJob] = []
    summary = await uow.job.add(BackgroundJob(
        operation_id=str(uuid.uuid4()), kind=OperationKind.SESSION_SUMMARY, retry_supported=False,
        scope=_scope(session.workspace_id, session_id), payload=payload,
        idempotency_key=f"summary:{session_id}:{seq}", progress=OperationProgress(completed=0, total=1)))
    jobs.append(summary)
    if auto_memory_enabled(workspace.settings):
        operation_id = str(uuid.uuid4())
        job = await uow.job.add(BackgroundJob(
            operation_id=operation_id, kind=OperationKind.MEMORY_EXTRACTION, retry_supported=False,
            scope=_scope(session.workspace_id, session_id), payload=payload,
            idempotency_key=f"extraction:{session_id}:{seq}", progress=OperationProgress(completed=0, total=1)))
        if job.operation_id == operation_id:  # 新登记的任务才登记代次；重复登记沿用已有的
            await memory.claim_extraction_in(uow, session.workspace_id, session_id, seq, operation_id)
        jobs.append(job)
    return jobs


# ---- 会话摘要 ----

def session_summary_handler(
        uow_factory: Callable[[], IUnitOfWork], retrieval: RetrievalService, llm_config: LLMConfigLoader,
        generate: SummaryGenerator = generate_summary,
):
    """摘要任务：先提交新代次与材料截止序号，再生成，写回时核对两者；迟到或材料已更新的结果丢弃。"""

    async def available(uow: IUnitOfWork, workspace_id: str, session_id: str):
        session = await uow.session.get_by_id(session_id)
        workspace = await uow.workspace.get(workspace_id)
        ok = (session is not None and session.workspace_id == workspace_id and session.participate_in_memory
              and workspace is not None and workspace.status is not WorkspaceStatus.DELETING)
        return ok

    async def mark_failed(session_id: str, generation: int, source_seq: int) -> None:
        async with uow_factory() as uow:
            current = await uow.summary.get(session_id)
            if current is not None and current.generation == generation and current.source_seq == source_seq:
                await uow.summary.save(current.model_copy(update={"state": SummaryState.FAILED,
                                                                  "updated_at": utc_now()}))

    async def handle(context: JobContext) -> dict:
        payload = context.job.payload
        workspace_id, session_id = payload["workspace_id"], payload["session_id"]
        async with uow_factory() as uow:
            if not await available(uow, workspace_id, session_id):
                return {"status": "skipped", "reason": "session_unavailable"}
            material = await uow.session.summary_material(session_id)
            source_seq = int(material["source_seq"])
            existing = await uow.summary.get(session_id)
            if not material["first_user"] and not material["finals"]:
                return {"status": "skipped", "reason": "no_material"}
            if existing is not None and existing.state is SummaryState.READY and existing.body \
                    and existing.source_seq >= source_seq:
                return {"status": "skipped", "reason": "up_to_date"}
            generation = existing.generation + 1 if existing is not None else 1
            await uow.summary.save(SessionSummaryRecord(
                session_id=session_id, workspace_id=workspace_id, body=existing.body if existing else "",
                source_seq=source_seq, generation=generation, model=existing.model if existing else None,
                state=SummaryState.GENERATING, created_at=existing.created_at if existing else utc_now()))
        await context.progress(phase="生成会话摘要")
        try:
            result = await generate(await llm_config(), material)
            text = str(result.get("text") or "").strip()
            if not text:
                raise SummaryUnavailable("摘要生成没有返回内容")
        except Exception:
            await mark_failed(session_id, generation, source_seq)  # 保留此前摘要，只标记失败
            raise
        await context.check_cancel()
        async with uow_factory() as uow:
            current = await uow.summary.get(session_id)
            if current is None or current.generation != generation or current.source_seq != source_seq:
                return {"status": "rejected", "reason": "generation_mismatch"}
            if not await available(uow, workspace_id, session_id):
                return {"status": "rejected", "reason": "session_unavailable"}
            ready = current.model_copy(update={"body": text, "model": result.get("model"),
                                               "state": SummaryState.READY, "updated_at": utc_now()})
            await uow.summary.save(ready)
            await retrieval.index_summary(uow, ready)
        return {"status": "ready", "generation": generation, "source_seq": source_seq}

    return handle


# ---- 自动记忆提炼 ----

def clip_material(material: dict[str, Any], source_seq_end: int) -> dict[str, Any]:
    """只保留截止位置之前的材料：提炼固定在任务登记时的位置，之后到达的消息属于下一次提炼。"""
    clipped = dict(material)
    clipped["user_updates"] = [item for item in material.get("user_updates", []) if item["seq"] <= source_seq_end]
    clipped["finals"] = [item for item in material.get("finals", []) if item["seq"] <= source_seq_end]
    clipped["source_seq"] = min(int(material.get("source_seq", 0)), source_seq_end)
    clipped.pop("run_states", None)
    return clipped


def memory_extraction_handler(
        uow_factory: Callable[[], IUnitOfWork], retrieval: RetrievalService, memory: MemoryService,
        extractor_factory: ExtractorFactory,
):
    """提炼任务：读取本会话材料，对每条候选检索同一工作区的相似活动条目并判定，最后一次性提交。
    模型失败时任务以失败结束，不提交任何内容；迟到结果由提交端按代次整体丢弃。"""

    async def similar_entries(workspace_id: str, fact: ProposedFact) -> list[dict[str, Any]]:
        hits = await retrieval.search(workspace_id, fact.content, [SearchSourceType.MEMORY], limit=SIMILAR_LIMIT)
        entries = await memory.get_many(workspace_id, [hit.source_id for hit in hits])
        return [{"id": e.id, "version": e.version, "content": e.content, "memory_type": e.memory_type.value,
                 "certainty": e.certainty.value, "origin": e.origin.value} for e in entries]

    async def handle(context: JobContext) -> dict:
        extraction = await memory.extraction_for_operation(context.job.operation_id)
        if extraction is None:
            return {"status": "skipped", "reason": "no_extraction_record"}
        if extraction.commit_status is not ExtractionCommitStatus.PENDING:
            return {"status": extraction.commit_status.value, "reason": "already_finished"}
        async with uow_factory() as uow:
            session = await uow.session.get_by_id(extraction.session_id)
            workspace = await uow.workspace.get(extraction.workspace_id)
            if (session is None or session.workspace_id != extraction.workspace_id or not session.participate_in_memory
                    or workspace is None or workspace.status is not WorkspaceStatus.ACTIVE
                    or not auto_memory_enabled(workspace.settings)):
                return {"status": "skipped", "reason": "not_participating"}
            material = await uow.session.summary_material(extraction.session_id)
        material = clip_material(material, extraction.source_seq_end)
        if not material["first_user"] and not material["user_updates"]:
            return {"status": "skipped", "reason": "no_material"}
        await context.progress(phase="提炼记忆")
        extractor = await extractor_factory()
        facts = await extractor.propose(material)  # 模型失败直接抛出：任务失败，不宣称已记住
        decisions: list[ExtractionDecision] = []
        for fact in facts[:EXTRACTION_MAX_ITEMS]:
            await context.check_cancel()
            similar = await similar_entries(extraction.workspace_id, fact)
            if similar:
                decisions.append(await extractor.decide(fact, similar))
            else:
                decisions.append(ExtractionDecision(action=ExtractionAction.ADD, content=fact.content,
                                                    memory_type=fact.memory_type))
        result = await memory.commit_extraction(extraction.id, decisions)
        return {"status": result.status.value, "reason": result.reason, "created": len(result.created),
                "updated": len(result.updated), "retracted": len(result.retracted),
                "candidates": len(result.candidates), "skipped": result.skipped}

    return handle
