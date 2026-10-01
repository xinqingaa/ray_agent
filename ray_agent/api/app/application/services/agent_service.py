#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import copy
import logging
import weakref
from dataclasses import dataclass, field
from datetime import datetime
from typing import AsyncGenerator, Optional, List, Type, Callable, Union

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.domain.external.event_notifier import EventNotifier, OutputDelta
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.sandbox import Sandbox, SandboxProjectBindingError
from app.domain.external.search import SearchEngine
from app.domain.external.task import Task
from app.domain.models.app_config import AgentConfig, MCPConfig, A2AConfig, ToolPolicyConfig
from app.domain.models.event import ApprovalStatus, EnvironmentEvent, ErrorEvent, Event, MessageEvent, TitleEvent
from app.domain.models.project import SANDBOX_PROJECT_DIR
from app.domain.models.run import Run, RunMode, RunReason, RunStatus, tools_for_turn
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.approvals import close_waiting_approval, latest_approvals, waiting_for_approval
from app.application.services.context_operations import compacting, ensure_context_idle
from app.domain.services.context.compactor import CompactionStatus, Compactor
from app.domain.services.context.budget import fixed_input_estimate, FIXED_INPUT_GUIDANCE
from app.domain.services.prompts.project import build_project_prompt, snapshot_prompt
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
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
MANUAL_COMPACT_TIMEOUT_SECONDS = 60.0
FALLBACK_POLL_SECONDS = 3.0  # 订阅期间没有通知时的兜底查询间隔


@dataclass
class PendingStart:
    """单进程启动所有权。停止只撤销所有权，耗时 Docker 创建返回后负责清理。"""
    messages: list[str] = field(default_factory=list)
    cancelled: bool = False
    worker: Optional[asyncio.Task] = None
    project_writer_token: Optional[str] = None


_starts = weakref.WeakKeyDictionary()


def pending_starts() -> dict[str, PendingStart]:
    return _starts.setdefault(asyncio.get_running_loop(), {})


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


@dataclass
class ManualCompaction:
    """手动压缩的结果。compacted 时带两条事件的 seq 与前后估算；skipped 时 reason 为 no_rounds，没有写事件。"""
    status: str
    reason: Optional[str] = None
    compact_seq: Optional[int] = None
    context_seq: Optional[int] = None
    before_total: Optional[int] = None
    after_total: Optional[int] = None
    summarized_turns: Optional[int] = None
    kept_turns: Optional[int] = None


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
            project_validator: Optional[Callable[[str], None]] = None,
            project_prepare=None,
            project_file_prepare=None,
            project_file_coordinator=None,
            project_attachments=None,
            project_delivery=None,
    ) -> None:
        """构造函数，完成Agent服务初始化"""
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._agent_config = agent_config
        self._mcp_config = mcp_config
        self._a2a_config = a2a_config
        self._project_validator = project_validator
        self._project_prepare = project_prepare
        self._project_file_prepare = project_file_prepare
        self._project_attachments = project_attachments
        self._project_delivery = project_delivery
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        self._project_coordinator = project_file_coordinator or ProjectFileCoordinator(uow_factory, sandbox_cls)
        self._tool_policy = tool_policy
        self._sandbox_cls = sandbox_cls
        self._task_cls = task_cls
        self._search_engine = search_engine
        self._file_storage = file_storage
        self._notifier = notifier
        self._ledger = ledger or RunLedger(uow_factory, notifier)
        logger.info(f"AgentService初始化成功")

    def _file_coordinator(self):
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        return getattr(self, '_project_coordinator', None) or ProjectFileCoordinator(self._uow_factory, self._sandbox_cls)

    async def _get_task(self, session: Session) -> Optional[Task]:
        """根据传递的任务会话获取任务实例"""
        # 1.从会话中取出任务id
        task_id = session.task_id
        if not task_id:
            return None

        # 2.调用人物类的get方法获取对应的任务实例
        return self._task_cls.get(task_id)

    def _validate_project_session(self, session: Session) -> None:
        if getattr(self, "_project_validator", None):
            self._project_validator(session.project_id)

    async def _create_task(self, session: Session, run_id: str, prior_status: Optional[SessionStatus]) -> Task:
        """根据传递的会话创建一个执行 run_id 的新任务"""
        if session.project_id:
            self._validate_project_session(session)
        if session.project_id and prior_status != SessionStatus.WAITING:
            prepare_files = getattr(self, '_project_file_prepare', None)
            if prepare_files:
                await prepare_files(session.project_id, session.id, run_id)
                async with self._uow:
                    current = await self._uow.run.get(run_id)
                if current is None or current.status != RunStatus.RUNNING:
                    raise asyncio.CancelledError()
            stop_writers = getattr(self._sandbox_cls, 'stop_project_writers', None)
            if stop_writers:
                await stop_writers(session.project_id)
        # 1.获取沙箱实例
        sandbox = None
        sandbox_id = session.sandbox_id
        if sandbox_id:
            sandbox = await self._sandbox_cls.get(sandbox_id)

        created_sandbox = sandbox is None
        # 2.判断是否能获取到沙箱(如果没有则创建)
        if not sandbox:
            # 3.沙箱不存在则创建一个新的(有可能被释放了)。绑定了项目时重新挂载同一个目录
            try:
                if session.project_id and hasattr(self._sandbox_cls, 'create_owned'):
                    sandbox = await self._sandbox_cls.create_owned(session.project_id, session.id, run_id)
                else:
                    sandbox = await self._sandbox_cls.create(project_id=session.project_id)
            except SandboxProjectBindingError as exc:
                raise ConflictError(str(exc)) from exc
            session.sandbox_id = sandbox.id

        # 4.从沙箱中获取浏览器实例
        try:
            if session.project_id:
                await sandbox.validate_project(session.project_id)
            browser = await sandbox.get_browser()
            if not browser:
                raise RuntimeError("执行环境浏览器不可用")
        except BaseException:
            if created_sandbox:
                await sandbox.destroy()
            raise

        try:
            # 5.创建AgentTaskRunner
            from app.application.services.project_memory_service import ProjectMemoryService
            project_memory = ProjectMemoryService(self._uow_factory, self._ledger)
            async def notes_update(content, base_version):
                from app.application.errors.exceptions import AppException
                from app.domain.models.tool_result import ToolResult
                try:
                    data = await project_memory.update_notes(session.project_id, content, base_version,
                        session_id=session.id, run_id=run_id)
                    return ToolResult(success=True, message='项目笔记已更新', data=data)
                except AppException as exc:
                    return ToolResult(success=False, message=str(exc), data=exc.data)
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
                project_notes_update=notes_update if session.project_id else None,
                workspace_dir=SANDBOX_PROJECT_DIR if session.project_id else None,
                project_prompt=build_project_prompt(session.project.instructions) if session.project else "",
            )

            task_runner._project_attachment_service = getattr(self, '_project_attachments', None)
            task_runner._project_delivery_service = getattr(self, '_project_delivery', None)
            task_runner._project_id = session.project_id
            task_runner._project_memory_service = project_memory

            # 6.创建尚未发布引用的任务，由后台启动所有权检查后登记
            task = self._task_cls.create(task_runner=task_runner)
            return task
        except BaseException:
            if created_sandbox:
                await sandbox.destroy()
            raise

    def _schedule_start(self, session: Session, run_id: str, prior_status, event: Event) -> None:
        owner = PendingStart(messages=[event.model_dump_json()])
        pending_starts()[run_id] = owner
        # 独立服务与工作单元：后台不复用请求中的事务对象。
        worker_service = copy.copy(self)
        worker_service._uow = self._uow_factory()
        from app.domain.services.project_file_coordinator import register_writer
        owner.project_writer_token = register_writer(session.project_id)
        owner.worker = asyncio.create_task(worker_service._start_run(
            session.model_copy(deep=True), run_id, prior_status, owner))

    async def _start_run(self, session: Session, run_id: str, prior_status, owner: PendingStart) -> None:
        task = None
        published = False
        original_sandbox_id = session.sandbox_id
        try:
            task = await self._create_task(session, run_id, prior_status)
            async with session_lock(session.id):
                async with self._uow:
                    active = await self._uow.run.get_active(session.id)
                    current = await self._uow.session.get_by_id(session.id)
                if (owner.cancelled or active is None or active.id != run_id
                        or active.status != RunStatus.RUNNING or current is None
                        or current.project_id != session.project_id):
                    return
                if session.project_id:
                    self._validate_project_session(session)
                async with self._uow:
                    if session.sandbox_id:
                        await self._uow.session.update_sandbox_id(session.id, session.sandbox_id)
                    await self._uow.session.update_task_id(session.id, task.id)
                for message in owner.messages:
                    await task.input_stream.put(message)
                await self._ledger.append(session.id, [EnvironmentEvent(status="ready")], run_id=run_id)
                if session.project_id:
                    from app.domain.services.project_file_coordinator import register_writer
                    runner = task.task_runner
                    runner._project_coordinator = self._file_coordinator()
                    runner._project_id = session.project_id
                    runner._project_writer_token = register_writer(session.project_id)
                await task.invoke()
                published = True
        except Exception as exc:
            logger.exception("会话[%s]准备执行环境失败", session.id)
            async with session_lock(session.id):
                await self._ledger.transition(
                    session.id, run_id, RunStatus.FAILED, RunReason.RUNNER_ERROR,
                    events_before=[ErrorEvent(error="准备执行环境失败：" + format_public_error(exc))])
        finally:
            try:
                if not published and task is not None:
                    task.cancel()
                    sandbox = getattr(getattr(task, "task_runner", None), "_sandbox", None)
                    if sandbox is not None and sandbox.id != original_sandbox_id:
                        await sandbox.destroy()
            finally:
                if pending_starts().get(run_id) is owner:
                    del pending_starts()[run_id]
                from app.domain.services.project_file_coordinator import retire_writer, ProjectFileCoordinator
                retire_writer(session.project_id, getattr(owner, 'project_writer_token', None))
                if session.project_id:
                    if not published and task is not None:
                        retire_writer(session.project_id, getattr(task.task_runner, "_project_writer_token", None))
                    await self._file_coordinator().settle(session.project_id)

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
            mode: RunMode = RunMode.NORMAL,
    ) -> ChatAccepted:
        """受理一条用户消息并立即返回；执行过程只通过事件流（stream_events）观察。

        路由在会话锁内决定：running 且有执行协程 → 注入当前运行；waiting → 同一运行续接；
        其他情况新建运行（数据库里 running 却没有执行协程的旧运行先记为 interrupted/runner_lost）。
        等待审批（waiting 且原因 approval）时不受理消息，返回冲突：先批准、拒绝或停止。
        mode 只在新建运行时生效：会走注入或续接路由时带 plan 返回冲突，普通模式下续接的运行沿用自己的模式。
        """
        set_log_session_id(session_id)
        if not message or not message.strip():
            raise BadRequestError("消息不能为空")
        mode = RunMode(mode)
        ensure_context_idle(session_id)

        async with self._uow:
            db_attachments = [await self._uow.file.get_by_id(file_id) for file_id in (attachments or [])]
        if any(attachment is None for attachment in db_attachments):
            raise BadRequestError("附件已失效，请移除并重新上传后发送")
        message_event = MessageEvent(
            role="user",
            message=message,
            attachments=[attachment for attachment in db_attachments if attachment is not None],
        )
        sent_at = timestamp or datetime.now()

        async def touch(uow: IUnitOfWork) -> None:
            if accepted_project_prompt is not None:
                accepted = await uow.run.get_active(session_id)
                await uow.run.save_snapshot(accepted.id, {"project_prompt": accepted_project_prompt, "project_context": session.project_snapshot.model_dump(mode="json") if session.project_snapshot else None})
            attachments_service = getattr(self, '_project_attachments', None)
            if attachments_service and session.project_id:
                accepted = await uow.run.get_active(session_id)
                await attachments_service.stage(uow, session.project_id, session_id, accepted.id, message_event)
            await uow.session.update_latest_message(session_id=session_id, message=message, timestamp=sent_at)
            if provisional_title is not None:
                await uow.session.set_title(session_id, provisional_title.title, "provisional", "placeholder")

        accepted_project_prompt = None

        async def prepare_project(uow: IUnitOfWork) -> None:
            nonlocal accepted_project_prompt
            current = await uow.session.get_by_id(session_id)
            if current is None or current.project_id != session.project_id:
                from app.domain.services.project_transactions import ProjectRunConflict
                raise ProjectRunConflict("对话归属刚刚发生变化，请刷新后重新发送")
            if current.project_id and getattr(self, "_project_prepare", None):
                await self._project_prepare(uow, current)
            session.project = current.project
            session.project_snapshot = current.project_snapshot
            if current.project:
                accepted_project_prompt = snapshot_prompt(current.project_snapshot) if current.project_snapshot else build_project_prompt(current.project.instructions)

        provisional_title: Optional[TitleEvent] = None
        async with session_lock(session_id):
            ensure_context_idle(session_id)
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                active = await self._uow.run.get_active(session_id) if session else None
            if not session:
                logger.error(f"尝试与不存在的任务会话[{session_id}]对话")
                raise NotFoundError("任务会话不存在, 请核实后重试")
            if session.project_id:
                self._validate_project_session(session)
            if waiting_for_approval(active):
                raise ConflictError("当前运行在等待审批，请先批准或拒绝待审批的操作，或停止运行后再发送消息")
            task = await self._get_task(session)
            starting = pending_starts().get(active.id) if active is not None else None
            if mode == RunMode.PLAN and active is not None and (
                    active.status == RunStatus.WAITING or starting is not None or self._task_runs(task, active.id)):
                raise ConflictError("当前运行还没有结束，计划模式只能在新运行开始时选择；请等运行结束或停止后再发送")

            # 1.运行中且执行协程仍在：消息注入当前运行，循环在下一次模型请求前取走
            if active is not None and active.status == RunStatus.RUNNING and (starting is not None or self._task_runs(task, active.id)):
                if await self._ledger.append(session_id, [message_event], run_id=active.id, apply=touch):
                    if starting is not None:
                        starting.messages.append(message_event.model_dump_json())
                    else:
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
                    session_id, active.id, RunStatus.RUNNING, events_after=[message_event, EnvironmentEvent(status="preparing")], apply=touch)
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
                    session_id, events_after=[message_event, EnvironmentEvent(status="preparing"), *([provisional_title] if provisional_title else [])],
                    apply=touch, mode=mode, before_start=prepare_project,
                )
                if provisional_title is not None:
                    from app.application.services.title_service import TitleService
                    asyncio.create_task(TitleService(self._uow_factory, self._ledger).auto_generate(session_id, message))

            self._schedule_start(session, run.id, prior_status, message_event)
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

            if session.project_id:
                self._validate_project_session(session)
            decided = request.decided(ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED)
            run = await self._ledger.transition(session_id, active.id, RunStatus.RUNNING, events_after=[decided, EnvironmentEvent(status="preparing")])
            if run is None:
                raise ConflictError("运行已结束，审批已失效")
            self._schedule_start(session, run.id, SessionStatus.WAITING, decided)
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
                result = await close_waiting_approval(self._uow_factory, self._ledger, session_id, active.id,
                                                    RunStatus.CANCELLED, RunReason.USER_STOP)
                if session.project_id:
                    from app.domain.services.project_file_coordinator import ProjectFileCoordinator
                    asyncio.create_task(self._file_coordinator().settle(session.project_id))
                return result
            starting = pending_starts().get(active.id)
            if starting is not None:
                starting.cancelled = True
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
        if session.project_id:
            from app.domain.services.project_file_coordinator import ProjectFileCoordinator
            asyncio.create_task(self._file_coordinator().settle(session.project_id))
        return run

    async def compact_session(self, session_id: str) -> ManualCompaction:
        async with compacting(session_id):
            try:
                async with asyncio.timeout(MANUAL_COMPACT_TIMEOUT_SECONDS):
                    return await self._compact_session(session_id)
            except TimeoutError as exc:
                raise AppException(code=504, status_code=504,
                                   msg="摘要超过总期限，请核对最新操作状态和压缩记录后再决定是否重试") from exc

    async def _compact_session(self, session_id: str) -> ManualCompaction:
        """手动压缩：在没有活动运行时把较早的轮次替换为摘要，不新建运行、不改会话状态。

        整个过程（含摘要请求）持有与 chat 共用的会话锁。会话不存在 → NotFoundError；有活动运行（running，
        或 waiting 不论提问还是审批）→ ConflictError；少于 2 轮 → skipped/no_rounds，不写事件；不做最小收益判断。
        成功时 compact(trigger=manual) 与 context(replace) 不带 run_id，与替换后的记忆在同一事务写入；
        摘要请求失败 → 502，不写事件、不改记忆。估算全部按字符计算：工具 schema 取最后一次运行的配置快照，
        窗口与输出预留取当前模型配置。
        """
        set_log_session_id(session_id)
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                if not session:
                    raise NotFoundError("任务会话不存在, 请核实后重试")
                active = await self._uow.run.get_active(session_id)
                runs = await self._uow.run.list_by_session(session_id)
                memory = await self._uow.session.get_memory(session_id, AGENT_MEMORY_NAME)
            if active is not None:
                raise ConflictError("会话有进行中或等待中的运行，不能手动压缩；请先停止运行或等待运行结束")

            last = max(runs, key=lambda r: r.started_at) if runs else None
            tools = tools_for_turn(last.config_snapshot, last.turns + 1) if last is not None else []
            compactor = Compactor(self._llm, self._agent_config, label=f"会话[{session_id}]手动压缩")
            messages = copy.deepcopy(memory.get_messages())
            project_prompt = ""
            if session.project and messages and messages[0].get("role") == "system":
                from app.domain.models.workspace_project import ProjectTaskSnapshot
                from app.domain.services.prompts.project import bounded_summaries
                async with self._uow:
                    project = await self._uow.project.get(session.project_id, lock=True)
                    summaries = await self._uow.session.recent_summaries(project.id, session.id)
                    current = ProjectTaskSnapshot(project_id=project.id, **project.model_dump(include={
                        'name', 'instructions', 'notes', 'notes_version', 'settings_version'}),
                        summaries=bounded_summaries(summaries))
                project_prompt = snapshot_prompt(current)
                messages[0]["content"] += project_prompt
            budget = compactor.fresh_budget()
            fixed = fixed_input_estimate(budget, messages, tools)
            if fixed.over_limit:
                raise AppException(code=422, status_code=422, msg=FIXED_INPUT_GUIDANCE,
                                   data={"reason": "context_limit", "fixed_input": fixed.as_dict()})
            before = budget.estimate(messages, tools)

            async def load_user_events():
                async with self._uow:
                    return await self._uow.event.list(session_id, types=["message"])

            result = await compactor.compact(messages, tools, before, "manual", load_user_events, min_gain=False)
            if result.status == CompactionStatus.SKIPPED:
                return ManualCompaction(status="skipped", reason=result.reason)
            if result.status == CompactionStatus.FAILED:
                raise AppException(code=502, status_code=502, msg=(
                    f"摘要请求连续 {result.usage.attempts} 次失败或返回空内容，上下文没有改变"))

            memory.replace(result.messages)

            async def save_memory(uow: IUnitOfWork) -> None:
                await uow.session.save_memory(session_id, AGENT_MEMORY_NAME, memory)

            compact, context = result.compact, result.context
            if project_prompt:
                compact.before_estimate["includes_project_context"] = True
                compact.after_estimate["includes_project_context"] = True
            await self._ledger.append(session_id, [compact, context], apply=save_memory)
        logger.info(f"会话[{session_id}]手动压缩完成 seq={compact.seq},{context.seq}")
        return ManualCompaction(
            status="compacted",
            compact_seq=compact.seq,
            context_seq=context.seq,
            before_total=compact.before_estimate.get("total"),
            after_total=compact.after_estimate.get("total"),
            summarized_turns=compact.summarized_turns,
            kept_turns=compact.kept_turns,
        )

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
        owners = list(pending_starts().values())
        for owner in owners:
            owner.cancelled = True
        # 不假定取消协程能取消 Docker 线程；让迟到资源走所有权检查和清理。
        await asyncio.gather(*(owner.worker for owner in owners if owner.worker is not None), return_exceptions=True)
        await self._task_cls.destroy()
        logger.info("所有会话任务资源清除成功")
