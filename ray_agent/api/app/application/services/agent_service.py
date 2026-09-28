#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/04 17:12
@Author  : thezehui@gmail.com
@File    : agent_service.py
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncGenerator, Optional, List, Type, Callable

from app.application.errors.exceptions import BadRequestError, NotFoundError
from app.domain.external.event_notifier import EventNotifier
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.external.task import Task
from app.domain.models.app_config import AgentConfig, MCPConfig, A2AConfig
from app.domain.models.event import ErrorEvent, Event, MessageEvent
from app.domain.models.run import Run, RunReason, RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.uow import IUnitOfWork
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
    ) -> None:
        """构造函数，完成Agent服务初始化"""
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._agent_config = agent_config
        self._mcp_config = mcp_config
        self._a2a_config = a2a_config
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
                await self._uow.session.save(session)

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
        )

        # 6.创建任务Task并更新会话中的信息
        task = self._task_cls.create(task_runner=task_runner)
        session.task_id = task.id
        async with self._uow:
            await self._uow.session.save(session)

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

        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                active = await self._uow.run.get_active(session_id) if session else None
            if not session:
                logger.error(f"尝试与不存在的任务会话[{session_id}]对话")
                raise NotFoundError("任务会话不存在, 请核实后重试")
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
                run = await self._ledger.start(session_id, events_after=[message_event], apply=touch)

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

    async def stream_events(self, session_id: str, after_seq: int = 0) -> AsyncGenerator[Event, None]:
        """按 seq 推送 after_seq 之后的事件：先补查数据库，再订阅通知，订阅建立后再补查一次覆盖空档；
        订阅期间收到通知或每隔 FALLBACK_POLL_SECONDS 都按最后 seq 查库，通知丢失时由兜底查询补齐。
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
                        await subscription.get(timeout=FALLBACK_POLL_SECONDS)
                    except Exception as e:
                        logger.warning(f"会话[{session_id}]读取事件通知失败，改为兜底查询: {e}")
                        subscription = None
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
            task = await self._get_task(session)
            runner = getattr(task, "task_runner", None) if task is not None else None
            if getattr(runner, "run_id", None) != active.id:
                task, runner = None, None
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
