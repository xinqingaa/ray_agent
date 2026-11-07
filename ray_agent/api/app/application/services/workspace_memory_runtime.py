"""运行与工作区记忆的衔接：给模型工具绑定工作区的端口、新运行的背景装配、续接前核对与运行结束后的任务登记。

工作区身份只在这里由会话解析并绑定到端口；工具参数、模型输出都不能指定或切换工作区。
"""
import logging
from typing import Any, Callable, Optional, Sequence

from app.application.errors.exceptions import BadRequestError
from app.application.services.context_assembly import ContextAssembly
from app.application.services.memory_jobs import enqueue_post_run_jobs
from app.application.services.memory_service import MemoryService
from app.application.services.retrieval_service import RetrievalService
from app.application.services.working_style_service import WorkingStyleService
from app.domain.models.session import Session
from app.domain.models.workspace_memory import MemoryEntry, MemoryOrigin, MemoryStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)

TOOL_LIST_STATUSES = {"active": MemoryStatus.ACTIVE, "candidate": MemoryStatus.CANDIDATE}


def memory_view(entry: MemoryEntry) -> dict[str, Any]:
    """给模型看的条目：身份、内容、类型与确定性，不含时间戳等内部字段。"""
    return {"id": entry.id, "content": entry.content, "memory_type": entry.memory_type.value,
            "certainty": entry.certainty.value, "origin": entry.origin.value, "status": entry.status.value,
            "pinned": entry.pinned, "version": entry.version}


class BoundWorkspaceMemory:
    """WorkspaceMemoryPort 的实现：工作区、会话与运行在构造时固定。"""

    def __init__(self, workspace_id: str, session_id: str, run_id: str, memory: MemoryService,
                 retrieval: RetrievalService, style: WorkingStyleService) -> None:
        self._workspace_id = workspace_id
        self._session_id = session_id
        self._run_id = run_id
        self._memory = memory
        self._retrieval = retrieval
        self._style = style

    async def remember(self, content: str, memory_type: str) -> dict[str, Any]:
        entry = await self._memory.create(
            self._workspace_id, content, memory_type, origin=MemoryOrigin.AGENT_REQUESTED,
            session_id=self._session_id, rationale="用户要求记住")
        return memory_view(entry)

    async def forget(self, memory_id: str) -> dict[str, Any]:
        entry = await self._memory.retract(
            self._workspace_id, memory_id, origin=MemoryOrigin.AGENT_REQUESTED, rationale="用户要求忘掉")
        return memory_view(entry)

    async def list_memories(self, status: str, limit: int) -> list[dict[str, Any]]:
        if status not in TOOL_LIST_STATUSES:
            raise BadRequestError("status 只能是 active 或 candidate")
        entries = await self._memory.entries(self._workspace_id, [TOOL_LIST_STATUSES[status]])
        return [memory_view(entry) for entry in entries[:max(1, limit)]]

    async def search(self, query: str, source_types: Optional[Sequence[str]]) -> list[dict[str, Any]]:
        hits = await self._retrieval.search(self._workspace_id, query, source_types)
        return [{"source_type": hit.source_type.value, "source_id": hit.source_id, "title": hit.title,
                 "snippet": hit.snippet, "certainty": hit.certainty, "stale": hit.stale,
                 "score": round(hit.score, 4)} for hit in hits]

    async def propose_working_style(self, body: str, rationale: str) -> dict[str, Any]:
        proposal = await self._style.propose(self._workspace_id, body, rationale, self._session_id)
        return {"proposal_id": proposal.id, "status": proposal.status.value, "base_version": proposal.base_version}


class WorkspaceMemoryRuntime:
    """AgentService 与运行器使用的入口。构造时不依赖具体运行，所有方法都容忍失败：
    背景装配或任务登记失败只记日志，不阻止运行，也不会改变运行结果。"""

    def __init__(self, memory: MemoryService, retrieval: RetrievalService, style: WorkingStyleService,
                 assembly: ContextAssembly, wake: Optional[Callable[[], None]] = None) -> None:
        self.memory = memory
        self.retrieval = retrieval
        self.style = style
        self.assembly = assembly
        self._wake = wake

    def ports(self, workspace_id: str, session_id: str, run_id: str) -> BoundWorkspaceMemory:
        return BoundWorkspaceMemory(workspace_id, session_id, run_id, self.memory, self.retrieval, self.style)

    async def assemble(self, session: Session, run_id: str, *, persist: bool = True) -> str:
        """新运行的长期背景段；失败时返回空串，运行照常进行。"""
        try:
            return (await self.assembly.assemble(session, run_id, persist=persist)).project_prompt
        except Exception:
            logger.exception("装配工作区背景失败，本次运行不带长期背景 session=%s", session.id)
            return ""

    async def refresh(self, run_id: str) -> Optional[str]:
        try:
            return await self.assembly.refresh_frozen(run_id)
        except Exception:
            logger.exception("核对冻结的工作区背景失败，沿用冻结内容 run=%s", run_id)
            return None

    async def on_run_completed(self, uow: IUnitOfWork, session_id: str, run_id: str) -> None:
        """运行正常结束的同一事务里登记摘要与提炼任务；登记失败只记日志。"""
        try:
            await enqueue_post_run_jobs(uow, self.memory, session_id)
        except Exception:
            logger.exception("登记摘要与提炼任务失败 session=%s run=%s", session_id, run_id)

    def wake(self) -> None:
        if self._wake is not None:
            self._wake()
