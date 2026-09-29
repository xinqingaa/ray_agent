#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncGenerator, Optional, List, Type, Callable, Union

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.external.event_notifier import EventNotifier, OutputDelta
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.external.task import Task
from app.domain.models.app_config import AgentConfig, MCPConfig, A2AConfig, ToolPolicyConfig
from app.domain.models.event import ApprovalStatus, ErrorEvent, Event, MessageEvent, TitleEvent
from app.domain.models.run import Run, RunReason, RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.approvals import close_waiting_approval, latest_approvals, waiting_for_approval
from app.domain.services.request_rebuild import RebuiltRequest, rebuild_request
from app.domain.services.run_ledger import RunLedger
from app.domain.services.session_locks import session_lock
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.a2a import A2ATool
from app.infrastructure.protocols.mcp import MCPClientManager
from app.infrastructure.protocols.a2a import A2AClientManager
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.task_error import format_public_error
from app.infrastructure.logging import set_log_session_id

logger = logging.getLogger(__name__)

EVENT_PAGE_SIZE = 200  # SSE 补查每页条数
FALLBACK_POLL_SECONDS = 3.0  # 订阅期间没有通知时的兜底查询间隔


@dataclass
class ChatAccepted:
    """chat 的受理结果：消息事件的 seq 与处理它的运行。route 是 started / resumed / injected 之一。"""
    run_id: str
    seq: int
    route: str


@dataclass
class ApprovalAccepted:
    """审批回复的受理结果：approval 事件（approved / rejected）的 seq 与续接的运行。"""
    run_id: str
    seq: int
    status: str


class AgentService:
    """Manus智能体服务"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            llm: LLM,
            agent_config: AgentConfig,
            mcp_config: MCPConfig,
            a2a_config: A2AConfig,
            sandbox_cls: Type[Sandbox],
            task_cls: Type[Task],
            search_engine: SearchEngine,
            file_storage: FileStorage,
            ledger: Optional[RunLedger] = None,
            notifier: Optional[EventNotifier] = None,
            tool_policy: Optional[ToolPolicyConfig] = None,
    ) -> None:
        """构造函数，完成Agent服务初始化"""
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._agent_config = agent_config
        self._mcp_config = mcp_config
        self._a2a_config = a2a_config
        self._tool_policy = tool_policy
        self._sandbox_cls = sandbox_cls
        self._task_cls = task_cls
        self._search_engine = search_engine
        self._file_storage = file_storage
        self._notifier = notifier
        self._ledger = ledger or RunLedger(uow_factory, notifier)
        logger.info(f"AgentService初始化成功")

    async def _get_task(self, session: Session) -> Optional[Task]:
        """根据传递的任务会话获取任务实例"""
        # 1.从会话中取出任务id
        task_id = session.task_id
        if not task_id:
            return None

        # 2.调用人物类的get方法获取对应的任务实例
        return self._task_cls.get(task_id)

    async def _create_task(self, session: Session, run_id: str, prior_status: Optional[SessionStatus]) -> Task:
        """根据传递的会话创建一个执行 run_id 的新任务"""
        # 1.获取沙箱实例
        sandbox = None
        sandbox_id = session.sandbox_id
        if sandbox_id:
            sandbox = await self._sandbox_cls.get(sandbox_id)

        # 2.判断是否能获取到沙箱(如果没有则创建)
        if not sandbox:
            # 3.沙箱不存在则创建一个新的(有可能被释放了)
            sandbox = await self._sandbox_cls.create()
            session.sandbox_id = sandbox.id
            async with self._uow:
                await self._uow.session.update_sandbox_id(session.id, sandbox.id)

        # 4.从沙箱中获取浏览器实例
        browser = await sandbox.get_browser()
        if not browser:
            logger.error(f"获取沙箱[{sandbox.id}]中的浏览器实例失败")
            raise RuntimeError(f"获取沙箱[{sandbox.id}]中的浏览器实例失败")

        # 5.创建AgentTaskRunner
        task_runner = AgentTaskRunner(
            uow_factory=self._uow_factory,
            llm=self._llm,
            agent_config=self._agent_config,
            mcp_tool=MCPTool(MCPClientManager(self._mcp_config)),
            a2a_tool=A2ATool(A2AClientManager(self._a2a_config)),
            session_id=session.id,
            file_storage=self._file_storage,
            browser=browser,
            search_engine=self._search_engine,
            sandbox=sandbox,
            ledger=self._ledger,
            run_id=run_id,
            prior_status=prior_status,
            tool_policy=self._tool_policy,
        )

        # 6.创建任务Task并更新会话中的信息
        task = self._task_cls.create(task_runner=task_runner)
        session.task_id = task.id
        async with self._uow:
            await self._uow.session.update_task_id(session.id, task.id)

        return task

    @staticmethod
    def _task_runs(task: Optional[Task], run_id: str) -> bool:
        """任务仍在执行 run_id：运行中补充的消息只能交给这样的任务。"""
        if task is None or task.done:
            return False
        runner = getattr(task, "task_runner", None)
        return getattr(runner, "run_id", None) == run_id

    async def chat(
            self,
            session_id: str,
            message: Optional[str] = None,
            attachments: Optional[List[str]] = None,
            timestamp: Optional[datetime] = None,
    ) -> ChatAccepted:
        """受理一条用户消息并立即返回；执行过程只通过事件流（stream_events）观察。

        路由在会话锁内决定：running 且有执行协程 → 注入当前运行；waiting → 同一运行续接；
        其他情况新建运行（数据库里 running 却没有执行协程的旧运行先记为 interrupted/runner_lost）。
        等待审批（waiting 且原因 approval）时不受理消息，返回冲突：先批准、拒绝或停止。
        """
        set_log_session_id(session_id)
        if not message or not message.strip():
            raise BadRequestError("消息不能为空")

        async with self._uow:
            db_attachments = [await self._uow.file.get_by_id(file_id) for file_id in (attachments or [])]
        message_event = MessageEvent(
            role="user",
            message=message,
            attachments=[attachment for attachment in db_attachments if attachment is not None],
        )
        sent_at = timestamp or datetime.now()

        async def touch(uow: IUnitOfWork) -> None:
            await uow.session.update_latest_message(session_id=session_id, message=message, timestamp=sent_at)
            if provisional_title is not None:
                await uow.session.set_title(session_id, provisional_title.title, "provisional", "placeholder")

        provisional_title: Optional[TitleEvent] = None
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                active = await self._uow.run.get_active(session_id) if session else None
            if not session:
                logger.error(f"尝试与不存在的任务会话[{session_id}]对话")
                raise NotFoundError("任务会话不存在, 请核实后重试")
            if waiting_for_approval(active):
                raise ConflictError("当前运行在等待审批，请先批准或拒绝待审批的操作，或停止运行后再发送消息")
            task = await self._get_task(session)

            # 1.运行中且执行协程仍在：消息注入当前运行，循环在下一次模型请求前取走
            if active is not None and active.status == RunStatus.RUNNING and self._task_runs(task, active.id):
                if await self._ledger.append(session_id, [message_event], run_id=active.id, apply=touch):
                    await task.input_stream.put(message_event.model_dump_json())
                    logger.info(f"会话[{session_id}]运行[{active.id}]注入消息: {message[:50]}...")
                    return ChatAccepted(run_id=active.id, seq=message_event.seq, route="injected")
                active = None

            run: Optional[Run] = None
            route = "started"
            prior_status: Optional[SessionStatus] = session.status
            # 2.等待回复：同一运行 waiting → running，由新任务续接
            if active is not None and active.status == RunStatus.WAITING:
                run = await self._ledger.transition(
                    session_id, active.id, RunStatus.RUNNING, events_after=[message_event], apply=touch)
                if run is not None:
                    route, prior_status = "resumed", SessionStatus.WAITING
            elif active is not None:
                # 3.数据库里仍是 running，但本进程已没有执行它的协程
                await self._ledger.transition(session_id, active.id, RunStatus.INTERRUPTED, RunReason.RUNNER_LOST)
                prior_status = SessionStatus.INTERRUPTED
            if run is None:
                if session.title_source == "placeholder" and session.title in ("", "新对话"):
                    provisional_title = TitleEvent(title=message.strip()[:30])
                run = await self._ledger.start(
                    session_id, events_after=[message_event, *([provisional_title] if provisional_title else [])],
                    apply=touch,
                )
                if provisional_title is not None:
                    from app.application.services.title_service import TitleService
                    asyncio.create_task(TitleService(self._uow_factory, self._ledger).auto_generate(session_id, message))

            # 4.创建执行任务；创建失败时运行记为失败，不留下没有协程的 running
            try:
                task = await self._create_task(session, run.id, prior_status)
                await task.input_stream.put(message_event.model_dump_json())
                await task.invoke()
            except Exception as e:
                logger.exception(f"会话[{session_id}]创建执行任务失败: {e}")
                await self._ledger.transition(
                    session_id, run.id, RunStatus.FAILED, RunReason.RUNNER_ERROR,
                    events_before=[ErrorEvent(error=format_public_error(e))],
                )
                raise
        logger.info(f"会话[{session_id}]运行[{run.id}]受理消息({route}): {message[:50]}...")
        return ChatAccepted(run_id=run.id, seq=message_event.seq, route=route)

    async def reply_approval(self, session_id: str, tool_call_id: str, approve: bool) -> ApprovalAccepted:
        """回复审批：同一事务把运行从 waiting（approval）改回 running 并写入 approval(approved / rejected)，
        再由新任务续接：批准时执行该调用一次，拒绝时回填“用户拒绝执行”。

        会话或审批请求不存在 → NotFoundError；该审批已回复、已失效，或运行不在等待这次审批 → ConflictError，不重复执行。
        """
        set_log_session_id(session_id)
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                if not session:
                    raise NotFoundError("任务会话不存在, 请核实后重试")
                approvals = await self._uow.event.list(session_id, types=["approval"])
                active = await self._uow.run.get_active(session_id)
            request = latest_approvals(approvals).get(tool_call_id)
            if request is None:
                raise NotFoundError("审批请求不存在, 请核实后重试")
            if (request.status != ApprovalStatus.PENDING or not waiting_for_approval(active)
                    or active.id != request.run_id):
                raise ConflictError(f"该审批已处理或已失效（当前状态：{request.status.value}），不会重复执行")

            decided = request.decided(ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED)
            run = await self._ledger.transition(session_id, active.id, RunStatus.RUNNING, events_after=[decided])
            if run is None:
                raise ConflictError("运行已结束，审批已失效")
            try:
                task = await self._create_task(session, run.id, SessionStatus.WAITING)
                await task.input_stream.put(decided.model_dump_json())
                await task.invoke()
            except Exception as e:
                logger.exception(f"会话[{session_id}]审批续接创建执行任务失败: {e}")
                await self._ledger.transition(
                    session_id, run.id, RunStatus.FAILED, RunReason.RUNNER_ERROR,
                    events_before=[ErrorEvent(error=format_public_error(e))],
                )
                raise
        logger.info(f"会话[{session_id}]运行[{run.id}]审批 {tool_call_id} → {decided.status.value}")
        return ApprovalAccepted(run_id=run.id, seq=decided.seq, status=decided.status.value)

    async def stream_events(self, session_id: str, after_seq: int = 0) -> AsyncGenerator[Union[Event, OutputDelta], None]:
        """按 seq 推送 after_seq 之后的事件：先补查数据库，再订阅通知，订阅建立后再补查一次覆盖空档；
        订阅期间收到落库通知或每隔 FALLBACK_POLL_SECONDS 都按最后 seq 查库，通知丢失时由兜底查询补齐。
        文本增量随通知立刻交出，不查库、不分配 seq，重连不会补发。
        不结束，由客户端断开。
        """
        set_log_session_id(session_id)
        async with self._uow:
            session = await self._uow.session.get_by_id(session_id)
        if not session:
            raise NotFoundError("任务会话不存在, 请核实后重试")

        last_seq = after_seq

        async def catch_up() -> AsyncGenerator[Event, None]:
            nonlocal last_seq
            while True:
                uow = self._uow_factory()
                async with uow:
                    page = await uow.event.list(session_id, after_seq=last_seq, limit=EVENT_PAGE_SIZE)
                for event in page:
                    last_seq = event.seq
                    yield event
                if len(page) < EVENT_PAGE_SIZE:
                    return

        async for event in catch_up():
            yield event
        subscription = None
        if self._notifier is not None:
            try:
                subscription = await self._notifier.subscribe(session_id)
            except Exception as e:
                logger.warning(f"会话[{session_id}]订阅事件通知失败，仅靠兜底查询: {e}")
        try:
            while True:
                async for event in catch_up():
                    yield event
                if subscription is not None:
                    try:
                        notice = await subscription.get(timeout=FALLBACK_POLL_SECONDS)
                    except Exception as e:
                        logger.warning(f"会话[{session_id}]读取事件通知失败，改为兜底查询: {e}")
                        subscription = None
                        continue
                    if isinstance(notice, OutputDelta):
                        yield notice
                        continue
                else:
                    await asyncio.sleep(FALLBACK_POLL_SECONDS)
        finally:
            if subscription is not None:
                try:
                    await subscription.close()
                except (asyncio.CancelledError, Exception) as e:
                    logger.debug(f"会话[{session_id}]关闭事件订阅: {e!r}")

    async def stop_session(self, session_id: str) -> Optional[Run]:
        """停止会话当前的运行：同一事务写入 cancelled 与终态事件，再取消执行协程并终止登记的 Shell 会话。

        没有活动运行时不做任何改动，返回 None。
        """
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                active = await self._uow.run.get_active(session_id) if session else None
            if not session:
                logger.error(f"尝试停止不存在的会话[{session_id}]")
                raise NotFoundError("任务会话不存在, 请核实后重试")
            if active is None:
                logger.info(f"会话[{session_id}]没有进行中的运行，无需停止")
                return None
            if waiting_for_approval(active):
                # 没有执行协程：审批失效，待审批与同批后续调用补为未执行，与终态同一事务
                return await close_waiting_approval(self._uow_factory, self._ledger, session_id, active.id,
                                                    RunStatus.CANCELLED, RunReason.USER_STOP)
            task = await self._get_task(session)
            runner = getattr(task, "task_runner", None) if task is not None else None
            if getattr(runner, "run_id", None) != active.id:
                task, runner = None, None
            # 进行中的模型请求先落一条 attempt，再进入终态。终态之后再写会被账本丢掉。
            open_attempt = getattr(runner, "open_attempt_event", None) if runner is not None else None
            if open_attempt is not None:
                pending = open_attempt()
                if pending is not None:
                    await self._ledger.append(session_id, [pending], run_id=active.id)
            run = await self._ledger.transition(
                session_id, active.id, RunStatus.CANCELLED, RunReason.USER_STOP,
                turn_closer=getattr(runner, "turn_snapshot", None),
            )
            if task is not None:
                task.cancel()
        if run is not None and runner is not None and hasattr(runner, "stop_processes"):
            await runner.stop_processes(active.id)
        return run

    async def get_turn_request(self, session_id: str, run_id: str, index: int) -> RebuiltRequest:
        """只读调试：由运行的配置快照与事件重建第 index 轮发给模型的请求。"""
        async with self._uow:
            run = await self._uow.run.get(run_id)
            if run is None or run.session_id != session_id:
                raise NotFoundError("运行不存在, 请核实后重试")
            events = await self._uow.event.list(session_id, types=["context", "turn"])
        try:
            return rebuild_request(events, run, index)
        except LookupError as e:
            raise NotFoundError(str(e)) from e

    async def shutdown(self) -> None:
        """关闭Agent服务"""
        logger.info("正在清除所有会话任务资源并释放")
        await self._task_cls.destroy()
        logger.info("所有会话任务资源清除成功")
