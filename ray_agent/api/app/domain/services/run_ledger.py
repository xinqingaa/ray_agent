#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""运行与事件的唯一写入入口。

写入顺序：事件与需要同步更新的状态在同一事务里提交 → 提交成功后发布通知（只含 session_id 与 seq）
→ 通知失败只记日志，不回滚事件，也不重放动作。
运行计数（轮数、模型请求、工具调用、tokens）在写入对应事件的同一事务里累加，终态 run 事件的汇总直接取自运行行。
"""
import logging
from datetime import datetime
from typing import Awaitable, Callable, List, Optional, Sequence

from app.domain.external.event_notifier import EventNotifier
from app.domain.models.event import BaseEvent, CompactEvent, RunEvent, ToolEvent, ToolEventStatus, TurnEvent, \
    TurnPhase
from app.domain.models.run import Run, RunReason, RunStatus
from app.domain.models.session import SessionStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)

Apply = Callable[[IUnitOfWork], Awaitable[None]]
TurnCloser = Callable[[int, str], Optional[TurnEvent]]


class _StaleRun(Exception):
    """运行已是终态：整笔事务回滚，迟到的事件不写入。"""


class RunLedger:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], notifier: Optional[EventNotifier] = None) -> None:
        self._uow_factory = uow_factory
        self._notifier = notifier

    # ---- 事件 ----

    async def append(
            self,
            session_id: str,
            events: Sequence[BaseEvent],
            run_id: Optional[str] = None,
            apply: Optional[Apply] = None,
            after_terminal: bool = False,
    ) -> List[BaseEvent]:
        """同一事务写入事件与附带的状态更新；提交成功后通知。

        带 run_id 时先锁住运行行：运行已是终态则整笔丢弃并返回空列表（停止后迟到的事件不写入），
        after_terminal=True 只用于终态之后的收尾记录（cleanup）。
        """
        if not events:
            return []
        uow = self._uow_factory()
        async with uow:
            if run_id is not None:
                run = await uow.run.lock(run_id)
                if run is None or (run.status.terminal and not after_terminal):
                    logger.info(f"会话[{session_id}] 运行[{run_id}]已是终态，丢弃 {len(events)} 条迟到事件")
                    return []
            await self._write(uow, session_id, events, run_id)
            if apply is not None:
                await apply(uow)
            await uow.commit()
        await self._notify(session_id, events[-1].seq)
        return list(events)

    # ---- 运行状态 ----

    async def start(
            self,
            session_id: str,
            events_after: Sequence[BaseEvent] = (),
            apply: Optional[Apply] = None,
    ) -> Run:
        """创建运行并写入 run(running) 事件与随后的事件；会话已有活动运行时抛 ActiveRunExistsError。"""
        run = Run(session_id=session_id)
        uow = self._uow_factory()
        async with uow:
            await uow.run.create(run)
            events = [RunEvent(status=RunStatus.RUNNING.value), *events_after]
            await self._write(uow, session_id, events, run.id)
            await uow.session.update_status(session_id, SessionStatus.RUNNING)
            if apply is not None:
                await apply(uow)
            await uow.commit()
        await self._notify(session_id, events[-1].seq)
        return run

    async def transition(
            self,
            session_id: str,
            run_id: str,
            status: RunStatus,
            reason: Optional[str] = None,
            events_before: Sequence[BaseEvent] = (),
            events_after: Sequence[BaseEvent] = (),
            apply: Optional[Apply] = None,
            turn_closer: Optional[TurnCloser] = None,
    ) -> Optional[Run]:
        """把活动运行改为 status，并在同一事务里写入 events_before、run 事件与 events_after。

        运行已是终态时整笔回滚、返回 None：终态不可再改，迟到的完成事件也不会写入。
        进入终态时若最后一轮只有 started，先补写它的 completed：turn_closer 能给出本轮已发生的尝试与用量时用它，
        否则只带 error；tool_call_ids 与 tools_ms 按已写入的 called 事件重算。这样每个终态运行的轮次都成对，
        汇总也包含停止前已发出的请求。
        """
        uow = self._uow_factory()
        try:
            async with uow:
                current = await uow.run.lock(run_id)
                if current is None or current.status.terminal:
                    raise _StaleRun()
                if status.terminal:
                    closing = await self._close_open_turn(uow, session_id, run_id, reason or status.value, turn_closer)
                    if closing is not None:
                        events_before = [closing, *events_before]
                await self._write(uow, session_id, events_before, run_id)
                ended_at = datetime.now() if status.terminal else None
                run = await uow.run.transition(run_id, status, reason, ended_at)
                if run is None:
                    raise _StaleRun()
                run_event = RunEvent(
                    status=status.value,
                    reason=reason,
                    summary=run.summary().model_dump() if status.terminal else None,
                )
                if ended_at is not None:
                    run_event.created_at = ended_at
                events = [*events_before, run_event, *events_after]
                await self._write(uow, session_id, [run_event, *events_after], run_id)
                await uow.session.update_status(session_id, SessionStatus(status.value))
                if apply is not None:
                    await apply(uow)
                await uow.commit()
        except _StaleRun:
            logger.info(f"会话[{session_id}] 运行[{run_id}]已是终态，忽略改为 {status.value}")
            return None
        await self._notify(session_id, events[-1].seq)
        return run

    async def interrupt_running(self) -> List[Run]:
        """启动扫描：running 的运行置为 interrupted；waiting 保持，用户回复后照常续接。"""
        uow = self._uow_factory()
        async with uow:
            running = await uow.run.list_by_status(RunStatus.RUNNING)
        interrupted = []
        for run in running:
            updated = await self.transition(run.session_id, run.id, RunStatus.INTERRUPTED, RunReason.API_RESTART)
            if updated is not None:
                interrupted.append(updated)
        return interrupted

    # ---- 内部 ----

    @staticmethod
    async def _close_open_turn(uow: IUnitOfWork, session_id: str, run_id: str, error: str,
                               turn_closer: Optional[TurnCloser]) -> Optional[TurnEvent]:
        history = await uow.event.list(session_id, types=["turn", "tool"], run_id=run_id)
        started = {e.index: e.seq for e in history if isinstance(e, TurnEvent) and e.phase == TurnPhase.STARTED}
        completed = {e.index for e in history if isinstance(e, TurnEvent) and e.phase == TurnPhase.COMPLETED}
        open_indexes = sorted(set(started) - completed)
        if not open_indexes:
            return None
        index = open_indexes[-1]
        closing = turn_closer(index, error) if turn_closer is not None else None
        if closing is None:
            closing = TurnEvent(phase=TurnPhase.COMPLETED, index=index, error=error)
        called = [e for e in history if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED
                  and e.seq > started[index]]
        closing.tool_call_ids = [e.tool_call_id for e in called]
        closing.tools_ms = sum(e.duration_ms or 0 for e in called)
        return closing

    @staticmethod
    async def _write(uow: IUnitOfWork, session_id: str, events: Sequence[BaseEvent], run_id: Optional[str]) -> None:
        for event in events:
            if event.run_id is None:
                event.run_id = run_id
            await uow.event.add(session_id, event)
            if event.run_id is None:
                continue
            if isinstance(event, TurnEvent):
                if event.phase == TurnPhase.STARTED:
                    await uow.run.add_counters(event.run_id, turns=1)
                else:
                    usage = event.usage
                    await uow.run.add_counters(
                        event.run_id,
                        model_requests=event.attempts or 0,
                        prompt_tokens=(usage.prompt_tokens or 0) if usage else 0,
                        completion_tokens=(usage.completion_tokens or 0) if usage else 0,
                        cached_tokens=usage.cached_tokens if usage else None,
                    )
            elif isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED:
                await uow.run.add_counters(event.run_id, tool_calls=1)
            elif isinstance(event, CompactEvent):
                # 摘要请求不算一轮，但计入模型请求数与 tokens
                usage = event.usage
                await uow.run.add_counters(
                    event.run_id,
                    model_requests=usage.attempts,
                    prompt_tokens=usage.prompt_tokens or 0,
                    completion_tokens=usage.completion_tokens or 0,
                    cached_tokens=usage.cached_tokens,
                )

    async def _notify(self, session_id: str, seq: Optional[int]) -> None:
        if self._notifier is None or seq is None:
            return
        try:
            await self._notifier.publish(session_id, seq)
        except Exception as e:
            logger.warning(f"会话[{session_id}] 事件通知发布失败（seq={seq}），订阅方将由兜底查询补齐: {e}")
