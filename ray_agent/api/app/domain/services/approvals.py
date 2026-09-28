#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""工具级审批的运行侧处理：查找待回复的审批请求；等待审批的运行被停止或中断时让审批失效并补结果。

等待提问的运行在 API 重启后保持 waiting、回复后续接；等待审批的不续接：批准针对的是重启前的执行环境，
所以启动扫描把它置为 interrupted，待审批的调用与同批后续调用补为未执行，用户需要重新发起任务。
"""
import copy
import logging
from typing import Callable, Dict, List, Optional, Sequence

from app.domain.models.event import ApprovalEvent, ApprovalStatus, BaseEvent, ContextEvent, ContextOp
from app.domain.models.run import Run, RunReason, RunStatus
from app.domain.models.session import SessionStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME, find_dangling_calls, repair_results
from app.domain.services.run_ledger import RunLedger

logger = logging.getLogger(__name__)


def waiting_for_approval(run: Optional[Run]) -> bool:
    return run is not None and run.status == RunStatus.WAITING and run.reason == RunReason.APPROVAL


def latest_approvals(events: Sequence[BaseEvent]) -> Dict[str, ApprovalEvent]:
    """每个调用最新的一条审批事件。"""
    latest: Dict[str, ApprovalEvent] = {}
    for event in events:
        if isinstance(event, ApprovalEvent):
            latest[event.tool_call_id] = event
    return latest


def pending_approval(events: Sequence[BaseEvent], run_id: str) -> Optional[ApprovalEvent]:
    """该运行仍待回复的审批请求；循环在第一个需要批准的调用处停下，所以至多一个。"""
    pending = [e for e in latest_approvals(events).values()
               if e.run_id == run_id and e.status == ApprovalStatus.PENDING]
    return pending[-1] if pending else None


async def close_waiting_approval(
        uow_factory: Callable[[], IUnitOfWork],
        ledger: RunLedger,
        session_id: str,
        run_id: str,
        status: RunStatus,
        reason: str,
) -> Optional[Run]:
    """把等待审批的运行改为终态，同一事务写入 approval(expired)、悬空调用的补结果（context 事件与记忆）与 run 事件。

    补结果按 W1 的悬空规则：停止与中断都是“未执行：任务已停止”。运行已是终态时返回 None，不改记忆。
    记忆在事务外读取，调用方须持有会话锁（与审批回复互斥），或在启动扫描、接受请求之前调用。
    """
    uow = uow_factory()
    async with uow:
        events = await uow.event.list(session_id, types=["approval"], run_id=run_id)
        memory = await uow.session.get_memory(session_id, AGENT_MEMORY_NAME)
    before: List[BaseEvent] = []
    pending = pending_approval(events, run_id)
    if pending is not None:
        before.append(pending.decided(ApprovalStatus.EXPIRED))
    repaired, _ = repair_results(find_dangling_calls(memory.get_messages()), SessionStatus(status.value))
    apply = None
    if repaired:
        memory.add_messages(repaired)
        before.append(ContextEvent(op=ContextOp.APPEND, messages=copy.deepcopy(repaired)))

        async def apply(u: IUnitOfWork) -> None:
            await u.session.save_memory(session_id, AGENT_MEMORY_NAME, memory)
    run = await ledger.transition(session_id, run_id, status, reason, events_before=before, apply=apply)
    if run is not None:
        logger.info(f"会话[{session_id}] 等待审批的运行[{run_id}]改为 {status.value}，补结果 {len(repaired)} 条")
    return run


async def interrupt_waiting_approvals(uow_factory: Callable[[], IUnitOfWork], ledger: RunLedger) -> List[Run]:
    """启动扫描的审批部分：等待审批的运行置为 interrupted（api_restart）；等待提问的运行保持 waiting。"""
    uow = uow_factory()
    async with uow:
        waiting = await uow.run.list_by_status(RunStatus.WAITING)
    interrupted = []
    for run in waiting:
        if not waiting_for_approval(run):
            continue
        updated = await close_waiting_approval(uow_factory, ledger, run.session_id, run.id,
                                               RunStatus.INTERRUPTED, RunReason.API_RESTART)
        if updated is not None:
            interrupted.append(updated)
    return interrupted
