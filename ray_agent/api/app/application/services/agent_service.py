#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import copy
import hashlib
import json
import logging
import weakref
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncGenerator, Callable, List, Optional, Type, Union

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.domain.external.event_notifier import EventNotifier, OutputDelta
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.search import SearchEngine
from app.domain.external.task import Task
from app.domain.models.app_config import AgentConfig, LLMConfig, MCPConfig, A2AConfig, ModelSampling, ToolPolicyConfig
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorCode
from app.domain.models.model_catalog import (
    choose_sampling, client_config, current_sampling, find_model, missing_reasoning, model_request,
    default_model, resolve_active, active_models,
)
from app.domain.models.event import ApprovalEvent, ApprovalStatus, ErrorEvent, Event, MessageEvent, TitleEvent
from app.domain.models.plan_acceptance import PlanAcceptance, PlanAlreadyAccepted, PlanAcceptanceConflict
from app.domain.models.run import Run, RunMode, RunReason, RunStatus, tools_for_turn
from app.domain.models.run_input import AcceptedRequest, RunInput
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.run_repository import ActiveRunExistsError
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.approvals import close_waiting_approval, latest_approvals, waiting_for_approval
from app.application.services.context_operations import compacting, ensure_context_idle
from app.domain.services.context.compactor import CompactionStatus, Compactor
from app.domain.services.context.budget import fixed_input_estimate, FIXED_INPUT_GUIDANCE
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
from app.domain.services.prompts.system import RuntimeEnvironment
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
FALLBACK_POLL_SECONDS = 3.0  # 有活动运行或刚有进展时，通知丢失后的查库间隔
IDLE_POLL_SECONDS = 30.0  # 连续空闲且没有活动运行后的查库间隔
IDLE_BACKOFF_AFTER = 2


def stream_poll_delay(idle_waits: int) -> float:
    """连续空闲达到阈值后拉长兜底间隔。"""
    if idle_waits >= IDLE_BACKOFF_AFTER:
        return IDLE_POLL_SECONDS
    return FALLBACK_POLL_SECONDS


def next_idle_waits(idle_waits: int, *, active: bool, progressed: bool) -> int:
    """有新事件、通知或活动运行时回到短间隔。"""
    if progressed or active:
        return 0
    return idle_waits + 1


@dataclass
class PendingStart:
    """单进程启动所有权：受理后到执行任务登记之间的窗口。停止只撤销所有权，后台准备结束后据此放弃启动。"""
    cancelled: bool = False
    worker: Optional[asyncio.Task] = None


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


def request_digest(session_id: str, **content) -> str:
    """请求身份对应的内容摘要：同身份不同内容视为冲突。"""
    payload = json.dumps({"session_id": session_id, **content}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


class AgentService:
    """会话执行的应用协调：受理消息与审批、启动与停止运行、按序号推送事件。"""
    _skills = None

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            llm: LLM,
            agent_config: AgentConfig,
            mcp_config: MCPConfig,
            a2a_config: A2AConfig,
            task_cls: Type[Task],
            search_engine: SearchEngine,
            file_storage: FileStorage,
            ledger: Optional[RunLedger] = None,
            notifier: Optional[EventNotifier] = None,
            tool_policy: Optional[ToolPolicyConfig] = None,
            skill_service=None,
            llm_config: Optional[LLMConfig] = None,
            workdirs=None,
            web_reader=None,
            capabilities=None,
            read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None,
    ) -> None:
        self._skills = skill_service
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._llm_config = llm_config
        self._agent_config = agent_config
        self._mcp_config = mcp_config
        self._a2a_config = a2a_config
        self._tool_policy = tool_policy
        self._task_cls = task_cls
        self._search_engine = search_engine
        self._file_storage = file_storage
        self._notifier = notifier
        self._ledger = ledger or RunLedger(uow_factory, notifier)
        self._workdirs = workdirs
        self._web_reader = web_reader
        self._capabilities = capabilities

    def _reader(self) -> IUnitOfWork:
        """只读事务；没有读连接池时退回普通工作单元。"""
        factory = getattr(self, "_read_uow_factory", None) or self._uow_factory
        return factory()

    def _session_sampling(self, session: Session) -> Optional[ModelSampling]:
        if session.context_window is None or session.max_tokens is None or session.temperature is None:
            return None
        return ModelSampling(
            temperature=session.temperature, max_tokens=session.max_tokens, context_window=session.context_window,
        )

    def _llm_for_session(self, session: Session):
        """已知厂商按会话选择构造客户端。已记下的窗口和温度优先于当前设置。"""
        if getattr(self, "_llm_config", None) is None:
            return self._llm
        sampling = self._session_sampling(session)
        profile = model_request(self._llm_config, model_id=session.model_id, reasoning=session.reasoning, sampling=sampling)
        return self._open_plain(sampling) if profile is None else self._open_llm(profile)

    async def _llm_for_run(self, session: Session, prior_status: Optional[SessionStatus], run_id: str):
        """新运行用这条对话记下的数值。等待续接沿用该次运行快照，不改进行中的模型。"""
        if getattr(self, "_llm_config", None) is None:
            return self._llm
        if prior_status == SessionStatus.WAITING:
            async with self._uow:
                run = await self._uow.run.get(run_id)
            stored = (run.config_snapshot or {}) if run is not None else {}
            if stored.get("model_name"):
                profile = model_request(
                    self._llm_config, model_id=session.model_id, reasoning=session.reasoning, snapshot=stored)
                return self._llm if profile is None else self._open_llm(profile, api_protocol=stored.get('api_protocol'))
        sampling = self._session_sampling(session)
        profile = model_request(
            self._llm_config, model_id=session.model_id, reasoning=session.reasoning, sampling=sampling)
        return self._open_plain(sampling) if profile is None else self._open_llm(profile)

    def _open_llm(self, profile, *, api_protocol=None):
        from app.infrastructure.external.llm.openai_llm import OpenAILLM
        tuned = client_config(self._llm_config, profile.model_name).model_copy(update={
            "model_name": profile.model_name,
            "context_window": profile.context_window,
            "max_tokens": profile.max_tokens,
            "temperature": profile.temperature,
        })
        if api_protocol:
            tuned = tuned.model_copy(update={'api_protocol': api_protocol})
        return OpenAILLM(
            tuned, thinking=profile.thinking, reasoning_effort=profile.reasoning_effort, reasoning_id=profile.reasoning_id,
            keep_reasoning=profile.keep_reasoning,
        )

    def _open_plain(self, sampling: Optional[ModelSampling]):
        """未知厂商没有目录。已记下数值时按那一份构造，否则用当前全局客户端。"""
        if sampling is None or getattr(self, "_llm_config", None) is None:
            return self._llm
        from app.infrastructure.external.llm.openai_llm import OpenAILLM
        tuned = self._llm_config.model_copy(update={
            "temperature": sampling.temperature,
            "context_window": sampling.context_window,
            "max_tokens": sampling.max_tokens,
        })
        return OpenAILLM(tuned)

    async def _latest_snapshot(self, session_id: str) -> Optional[dict]:
        async with self._uow:
            runs = await self._uow.run.list_by_session(session_id)
        if not runs:
            return None
        last = max(runs, key=lambda item: item.started_at)
        stored = last.config_snapshot or {}
        return stored if stored.get("context_window") else None

    async def _bind_sampling(self, session: Session, *, creating: bool, model_changed: bool) -> None:
        """第一次运行记下当前模型的三项。已有对话改设置不重写；对话里换模型才改成目标模型当前的数值。"""
        if getattr(self, "_llm_config", None) is None:
            return
        frozen = self._session_sampling(session)
        current = current_sampling(self._llm_config, session.model_id)
        snapshot = None if creating or model_changed else await self._latest_snapshot(session.id)
        chosen = choose_sampling(frozen=frozen, model_changed=model_changed, snapshot=snapshot, current=current)
        session.context_window = chosen.context_window
        session.max_tokens = chosen.max_tokens
        session.temperature = chosen.temperature
        if creating:
            return
        async with self._uow:
            if session.model_id is not None:
                await self._uow.session.update_model(session.id, session.model_id, session.reasoning)
            await self._uow.session.update_sampling(
                session.id, chosen.context_window, chosen.max_tokens, chosen.temperature)

    async def _remember_model(self, session: Session, model: Optional[str], reasoning: Optional[str], *, creating: bool) -> None:
        """把选择写到会话上。旧对话没有思考字段时，未指定选择则先用 disabled，避免下一次请求被拒绝。"""
        if getattr(self, "_llm_config", None) is None:
            return
        if default_model(self._llm_config) is None and model is None and session.model_id is None:
            if model or reasoning:
                raise BadRequestError("当前接口没有可选模型")
            return
        if (model is None) ^ (reasoning is None):
            raise BadRequestError("模型和思考强度需要一起提交")
        memory = session.memories.get(AGENT_MEMORY_NAME)
        messages = list(memory.messages) if memory is not None else []
        if model is None and session.model_id and session.reasoning:
            return
        chosen_reasoning = reasoning
        target_id = model or session.model_id
        target = find_model(target_id) if target_id else default_model(self._llm_config)
        if model is None and missing_reasoning(messages) and target is not None and target.choice("disabled"):
            chosen_reasoning = "disabled"
        try:
            spec, choice = resolve_active(self._llm_config, target_id, chosen_reasoning or session.reasoning)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        if choice.replay == "all_turns" and missing_reasoning(messages):
            raise BadRequestError("这条对话已经丢掉思考内容，请新开对话再打开思考")
        session.model_id = spec.id
        session.reasoning = choice.id

    async def set_model(self, session_id: str, model: str, reasoning: str) -> tuple[str, str]:
        """保存下一次新运行的模型与思考强度。进行中的运行仍用自己的快照。"""
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
            if session is None:
                raise NotFoundError("任务会话不存在, 请核实后重试")
            previous_model = session.model_id
            await self._remember_model(session, model, reasoning, creating=False)
            ensure_context_idle(session_id)
            await self._bind_sampling(session, creating=False,
                model_changed=previous_model is not None and session.model_id != previous_model)
        return session.model_id or model, session.reasoning or reasoning

    async def _environment(self, workdir=None) -> RuntimeEnvironment:
        provider = getattr(self, "_capabilities", None)
        capabilities = await provider.current() if provider is not None else []
        return RuntimeEnvironment(
            workdir=str(workdir.path) if workdir is not None else None,
            uploads=str(workdir.uploads) if workdir is not None else None,
            capabilities={status.capability: status for status in capabilities},
        )

    async def _workdir(self, session_id: str):
        if getattr(self, "_workdirs", None) is None:
            return None
        async with self._reader() as uow:
            registered = await uow.root.session_workdir(session_id)
        if registered is None:
            return None
        return self._workdirs.resolve(*registered)

    async def preview_context(self, session_id: str, mode: RunMode = RunMode.NORMAL) -> dict:
        """下一新运行的只读请求估算；不启动执行、调用模型或修改记忆。"""
        from app.domain.services.flows.agent_loop import AgentLoop, build_default_tools
        from app.domain.services.prompts.system import build_system_prompt
        async with session_lock(session_id):
            ensure_context_idle(session_id)
            async with self._reader() as uow:
                session = await uow.session.get_by_id(session_id)
                if session is None:
                    raise NotFoundError("对话不存在")
                memory = await uow.session.get_memory(session_id, AGENT_MEMORY_NAME)
            session = copy.deepcopy(session)
            await self._remember_model(session, None, None, creating=True)
            if getattr(self, "_llm_config", None) is not None:
                sampling = choose_sampling(frozen=self._session_sampling(session), model_changed=False,
                    snapshot=await self._latest_snapshot(session.id),
                    current=current_sampling(self._llm_config, session.model_id))
                session.context_window, session.max_tokens, session.temperature = (
                    sampling.context_window, sampling.max_tokens, sampling.temperature)
            llm = self._llm_for_session(session)
            mcp = MCPTool(MCPClientManager(self._mcp_config))
            a2a = A2ATool(A2AClientManager(self._a2a_config))
            try:
                if mcp.gateway.errors:
                    raise BadRequestError("工具发现失败，暂时无法估算下一次运行，请重试")
                workdir = await self._workdir(session_id)
                system_prompt = build_system_prompt(await self._environment(workdir))
                loop = AgentLoop(uow_factory=self._uow_factory, llm=llm,
                    agent_config=self._agent_config, session_id=session.id, mode=mode,
                    tools=build_default_tools(None, None, self._search_engine, mcp, a2a,
                                             web_reader=getattr(self, '_web_reader', None)),
                    system_prompt=system_prompt, tool_policy=self._tool_policy)
                messages = copy.deepcopy(memory.get_messages()) if memory else []
                if not messages or messages[0].get("role") != "system":
                    messages.insert(0, {"role": "system", "content": system_prompt})
                messages[0]["content"] = loop._with_mode_suffix(str(messages[0].get("content") or ""))
                if not getattr(llm, "keep_reasoning", False):
                    for message in messages:
                        message.pop("reasoning_content", None)
                tools = loop.pipeline.schemas()
                estimate = loop.budget.estimate(messages, tools)
                fixed = fixed_input_estimate(loop.budget, messages, tools)
                return dict(**estimate.as_dict(), model=session.model_id or llm.model_name,
                    reasoning=getattr(llm, "reasoning_id", session.reasoning), fixed_input_exceeded=fixed.over_limit,
                    over_watermark=estimate.over_watermark, over_limit=estimate.over_limit)
            finally:
                await mcp.cleanup()

    async def _get_task(self, run_id: str) -> Optional[Task]:
        task_cls = getattr(self, "_task_cls", None)
        return task_cls.get(run_id) if task_cls is not None else None

    async def _create_task(self, session: Session, run_id: str, prior_status: Optional[SessionStatus],
                           approval: Optional[ApprovalEvent] = None) -> Task:
        """组装执行 run_id 的任务。依赖执行环境的工具按能力声明关闭，纯对话不准备任何执行资源。"""
        workdir = await self._workdir(session.id)
        from app.application.services.skill_runtime import SkillRuntime
        skill_runtime = SkillRuntime(self._skills, run_id, None) if self._skills else None
        task_runner = AgentTaskRunner(
            uow_factory=self._uow_factory,
            llm=await self._llm_for_run(session, prior_status, run_id),
            agent_config=self._agent_config,
            mcp_tool=MCPTool(MCPClientManager(self._mcp_config)),
            a2a_tool=A2ATool(A2AClientManager(self._a2a_config)),
            session_id=session.id,
            file_storage=self._file_storage,
            search_engine=self._search_engine,
            ledger=self._ledger,
            run_id=run_id,
            prior_status=prior_status,
            tool_policy=self._tool_policy,
            skill_runtime=skill_runtime,
            workdir=workdir,
            environment=await self._environment(workdir),
            web_reader=getattr(self, '_web_reader', None),
            approval=approval,
        )
        return self._task_cls.create(task_runner=task_runner)

    def _schedule_start(self, session: Session, run_id: str, prior_status, approval: Optional[ApprovalEvent] = None) -> None:
        owner = PendingStart()
        pending_starts()[run_id] = owner
        # 独立服务与工作单元：后台不复用请求中的事务对象。
        worker_service = copy.copy(self)
        worker_service._uow = self._uow_factory()
        owner.worker = asyncio.create_task(worker_service._start_run(
            session.model_copy(deep=True), run_id, prior_status, owner, approval))

    async def _start_run(self, session: Session, run_id: str, prior_status, owner: PendingStart,
                         approval: Optional[ApprovalEvent] = None) -> None:
        task = None
        published = False
        try:
            if approval is None:
                task = await self._create_task(session, run_id, prior_status)
            else:
                task = await self._create_task(session, run_id, prior_status, approval=approval)
            async with session_lock(session.id):
                async with self._uow:
                    active = await self._uow.run.get_active(session.id)
                if owner.cancelled or active is None or active.id != run_id or active.status != RunStatus.RUNNING:
                    return
                await task.invoke()
                published = True
        except Exception as exc:
            logger.exception("会话[%s]启动运行失败", session.id)
            async with session_lock(session.id):
                await self._ledger.transition(
                    session.id, run_id, RunStatus.FAILED, RunReason.RUNNER_ERROR,
                    events_before=[ErrorEvent(error="启动运行失败：" + format_public_error(exc))])
        finally:
            if not published and task is not None:
                task.cancel()
            if pending_starts().get(run_id) is owner:
                del pending_starts()[run_id]

    def _task_runs(self, task: Optional[Task], run_id: str) -> bool:
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
            model: Optional[str] = None,
            reasoning: Optional[str] = None,
            image_mode: str = 'auto',
            execute_plan: Optional[PlanAcceptance] = None,
            skill=None,
            request_id: Optional[str] = None,
    ) -> ChatAccepted:
        """受理一条用户消息并立即返回；执行过程只通过事件流（stream_events）观察。

        消息事件、运行（新建或续接）与一条待消费输入在同一事务提交；带请求身份时受理结果同事务登记，
        同身份同内容返回原结果，内容不同返回冲突。
        路由在会话锁内决定：running 且有执行协程 → 注入当前运行；waiting → 同一运行续接；
        其他情况新建运行（数据库里 running 却没有执行协程的旧运行先记为 interrupted/runner_lost）。
        等待审批（waiting 且原因 approval）时不受理消息，返回冲突：先批准、拒绝或停止。
        mode 只在新建运行时生效：会走注入或续接路由时带 plan 返回冲突，普通模式下续接的运行沿用自己的模式。
        """
        set_log_session_id(session_id)
        if not message or not message.strip():
            raise BadRequestError("消息不能为空")
        mode = RunMode(mode)
        if image_mode not in ('auto', 'files'):
            raise BadRequestError('未知图片输入方式')
        ensure_context_idle(session_id)
        digest = request_digest(
            session_id, message=message, attachments=list(attachments or []), mode=mode.value, image_mode=image_mode,
            model=model, reasoning=reasoning, skill=skill.model_dump() if skill is not None else None,
            execute_plan=execute_plan.model_dump() if execute_plan is not None else None,
        ) if request_id else None
        if request_id:
            replay = await self._replay_request(request_id, digest)
            if replay is not None:
                return replay

        async with self._uow:
            db_attachments = [await self._uow.file.get_by_id(file_id) for file_id in (attachments or [])]
        if any(attachment is None for attachment in db_attachments):
            raise BadRequestError("附件已失效，请移除并重新上传后发送")
        if any(attachment.session_id not in (None, session_id) for attachment in db_attachments):
            raise BadRequestError("附件属于其他对话，请重新上传后发送")
        message_event = MessageEvent(
            role="user",
            message=message,
            image_mode=image_mode,
            skill=skill,
            attachments=[attachment for attachment in db_attachments if attachment is not None],
        )
        sent_at = timestamp or utc_now()
        provisional_title: Optional[TitleEvent] = None
        route_box = {"route": "started"}

        async def accept(uow: IUnitOfWork) -> None:
            if request_id and await uow.request.get(request_id) is not None:
                raise ConflictError("此请求标识已受理，请按请求标识读回结果")
            if self._skills is not None:
                await self._skills.accept(uow, session_id, skill)
            await uow.file.bind_session([file.id for file in message_event.attachments], session_id)
            await uow.run_input.add(RunInput(session_id=session_id, run_id=message_event.run_id,
                                             message_seq=message_event.seq, request_id=request_id))
            if request_id:
                await uow.request.add(AcceptedRequest(
                    request_id=request_id, session_id=session_id, kind="chat", digest=digest,
                    result=dict(run_id=message_event.run_id, seq=message_event.seq, route=route_box["route"])))
            await uow.session.update_latest_message(session_id=session_id, message=message, timestamp=sent_at)
            if provisional_title is not None:
                await uow.session.set_title(session_id, provisional_title.title, "provisional", "placeholder")

        async with session_lock(session_id):
            ensure_context_idle(session_id)
            if request_id:
                replay = await self._replay_request(request_id, digest)
                if replay is not None:
                    return replay
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                active = await self._uow.run.get_active(session_id) if session else None
            if not session:
                raise NotFoundError("任务会话不存在, 请核实后重试")
            if skill is not None and self._skills is not None:
                await self._skills.validate_selection(skill.model_dump())
                if active is not None and active.status.active and (active.config_snapshot or {}).get("skills_frozen"):
                    bound = await self._skills.bindings(active.id)
                    selected = next((e for e in bound if e["name"] == skill.id), None)
                    if not selected or selected["version"] != skill.version:
                        raise ConflictError("本运行 Skill 目录已固定，请在新运行中选择此版本")
            if execute_plan is not None:
                # 独立受理路径：不能误入运行中注入/等待续接；写事务串行化重试。
                if mode != RunMode.NORMAL or attachments or skill is not None:
                    raise BadRequestError("确认计划只能以普通模式、不附带附件提交")
                await self._remember_model(session, model, reasoning, creating=False)
                await self._bind_sampling(session, creating=False, model_changed=False)
                try:
                    run = await self._ledger.start(session_id, events_after=[message_event],
                        apply=accept, execute_plan=execute_plan)
                except PlanAlreadyAccepted as prior:
                    return ChatAccepted(run_id=prior.run.id, seq=prior.seq, route="started")
                except PlanAcceptanceConflict as error:
                    raise ConflictError(str(error)) from error
                self._schedule_start(session, run.id, session.status)
                return ChatAccepted(run_id=run.id, seq=message_event.seq, route="started")
            previous_model = session.model_id
            await self._remember_model(session, model, reasoning, creating=False)
            await self._bind_sampling(
                session, creating=False,
                model_changed=previous_model is not None and session.model_id != previous_model,
            )
            if waiting_for_approval(active):
                raise ConflictError("当前运行在等待审批，请先批准或拒绝待审批的操作，或停止运行后再发送消息")
            task = await self._get_task(active.id) if active is not None else None
            starting = pending_starts().get(active.id) if active is not None else None
            executing = active is not None and active.status == RunStatus.RUNNING and (
                starting is not None or self._task_runs(task, active.id))
            if mode == RunMode.PLAN and active is not None and (active.status == RunStatus.WAITING or executing):
                raise ConflictError("当前运行还没有结束，计划模式只能在新运行开始时选择；请等运行结束或停止后再发送")

            from app.infrastructure.external.file_storage.image_input import is_image_attachment
            if image_mode == 'auto' and any(is_image_attachment(file) for file in message_event.attachments):
                from app.application.services.attachment_images import prepare_attachment_images
                consumes_active = active is not None and (active.status == RunStatus.WAITING or executing)
                snapshot = (active.config_snapshot or {}) if consumes_active else {}
                config = getattr(self, '_llm_config', None)
                models = active_models(config) if config else ()
                selected_id = snapshot.get('model_name') or session.model_id
                spec = next((item for item in models if item.id == selected_id), None) if selected_id else next((item for item in models if item.auxiliary), None)
                supports_vision = snapshot.get('vision', spec.vision if spec else bool(getattr(self._llm, 'supports_vision', False)))
                message_event.image_inputs = await prepare_attachment_images(self._file_storage, message_event, session_id, supports_vision)

            # 1.运行中且执行协程仍在：消息注入当前运行，循环在下一次模型请求前从持久输入取走
            if executing:
                route_box["route"] = "injected"
                if await self._ledger.append(session_id, [message_event], run_id=active.id, apply=accept):
                    logger.info(f"会话[{session_id}]运行[{active.id}]注入消息: {message[:50]}...")
                    return ChatAccepted(run_id=active.id, seq=message_event.seq, route="injected")
                active = None

            run: Optional[Run] = None
            route = "started"
            prior_status: Optional[SessionStatus] = session.status
            # 2.等待回复：同一运行 waiting → running，由新任务续接
            if active is not None and active.status == RunStatus.WAITING:
                route_box["route"] = "resumed"
                run = await self._ledger.transition(session_id, active.id, RunStatus.RUNNING,
                                                    events_after=[message_event], apply=accept)
                if run is not None:
                    route, prior_status = "resumed", SessionStatus.WAITING
            elif active is not None:
                # 3.数据库里仍是 running，但本进程已没有执行它的协程
                await self._ledger.transition(session_id, active.id, RunStatus.INTERRUPTED, RunReason.RUNNER_LOST)
                prior_status = SessionStatus.INTERRUPTED
            if run is None:
                route_box["route"] = "started"
                if session.title_source == "placeholder" and session.title in ("", "新对话"):
                    provisional_title = TitleEvent(title=message.strip()[:30])
                run = await self._ledger.start(
                    session_id, events_after=[message_event, *([provisional_title] if provisional_title else [])],
                    apply=accept, mode=mode,
                )
                if provisional_title is not None:
                    from app.application.services.title_service import TitleService
                    asyncio.create_task(TitleService(self._uow_factory, self._ledger, read_uow_factory=self._reader())
                                        .auto_generate(session_id, message))

            self._schedule_start(session, run.id, prior_status)
        logger.info(f"会话[{session_id}]运行[{run.id}]受理消息({route}): {message[:50]}...")
        return ChatAccepted(run_id=run.id, seq=message_event.seq, route=route)

    async def _replay_request(self, request_id: str, digest: str) -> Optional[ChatAccepted]:
        async with self._reader() as uow:
            accepted = await uow.request.get(request_id)
        if accepted is None:
            return None
        if accepted.digest != digest:
            raise ConflictError("此请求标识已受理其他内容，请核对原对话")
        return ChatAccepted(**accepted.result)

    async def accepted_request(self, session_id: str, request_id: str) -> ChatAccepted:
        """按请求身份读回受理结果；发送结果未知时先读回，不重新发起。"""
        async with self._reader() as uow:
            accepted = await uow.request.get(request_id)
        if accepted is None or accepted.session_id != session_id:
            raise NotFoundError("没有找到该请求的受理记录，请求可能尚未到达核心")
        return ChatAccepted(**accepted.result)

    async def resume_input(self, session_id: str, input_id: int) -> ChatAccepted:
        """为所属运行已结束、尚未消费的输入明确发起新运行：输入交给新运行，消息事件不重复写入。"""
        set_log_session_id(session_id)
        ensure_context_idle(session_id)
        async with session_lock(session_id):
            async with self._uow:
                session = await self._uow.session.get_by_id(session_id)
                item = await self._uow.run_input.get(input_id)
                previous = await self._uow.run.get(item.run_id) if item is not None else None
                active = await self._uow.run.get_active(session_id) if session is not None else None
            if session is None:
                raise NotFoundError("任务会话不存在, 请核实后重试")
            if item is None or item.session_id != session_id:
                raise NotFoundError("没有找到这条待处理的消息")
            if item.status.value != "pending" or previous is None or previous.status.active:
                raise ConflictError("这条消息已在处理中或已处理，无需重新发起")
            if active is not None:
                raise ConflictError("当前有进行中或等待中的运行，请等它结束或停止后再重新发起")

            async def take_over(uow: IUnitOfWork) -> None:
                current = await uow.run_input.get(input_id)
                if current is None or current.status.value != "pending" or current.run_id != previous.id:
                    raise ConflictError("这条消息已在处理中或已处理，无需重新发起")
                active = await uow.run.get_active(session_id)
                await uow.run_input.reassign(input_id, active.id)

            try:
                run = await self._ledger.start(session_id, apply=take_over, mode=previous.mode)
            except ActiveRunExistsError as exc:
                raise ConflictError("当前有进行中或等待中的运行，请等它结束或停止后再重新发起") from exc
            self._schedule_start(session, run.id, session.status)
        logger.info(f"会话[{session_id}]为输入[{input_id}]重新发起运行[{run.id}]")
        return ChatAccepted(run_id=run.id, seq=item.message_seq, route="started")

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
            self._schedule_start(session, run.id, SessionStatus.WAITING, approval=decided)
        logger.info(f"会话[{session_id}]运行[{run.id}]审批 {tool_call_id} → {decided.status.value}")
        return ApprovalAccepted(run_id=run.id, seq=decided.seq, status=decided.status.value)

    async def stream_events(self, session_id: str, after_seq: int = 0) -> AsyncGenerator[Union[Event, OutputDelta], None]:
        """按 seq 推送 after_seq 之后的事件：先补查数据库，再订阅通知，订阅建立后再补查一次覆盖空档；
        订阅期间收到落库通知就按最后 seq 查库。没有通知时，有活动运行仍按短间隔查；连续空闲后改为长间隔。通知丢失时由这次查库补齐。
        文本增量随通知立刻交出，不查库、不分配 seq，重连不会补发。
        不结束，由客户端断开。
        """
        set_log_session_id(session_id)
        async with self._reader() as uow:
            session = await uow.session.get_by_id(session_id)
        if not session:
            raise NotFoundError("任务会话不存在, 请核实后重试")

        last_seq = after_seq

        async def catch_up() -> AsyncGenerator[Event, None]:
            nonlocal last_seq
            while True:
                async with self._reader() as uow:
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
        idle_waits = 0
        try:
            while True:
                progressed = False
                async for event in catch_up():
                    progressed = True
                    yield event
                if progressed:
                    idle_waits = 0
                notice = None
                if subscription is not None:
                    try:
                        notice = await subscription.get(timeout=stream_poll_delay(idle_waits))
                    except Exception as e:
                        logger.warning(f"会话[{session_id}]读取事件通知失败，改为兜底查询: {e}")
                        subscription = None
                        continue
                    if isinstance(notice, OutputDelta):
                        idle_waits = 0
                        yield notice
                        continue
                    if notice is not None:
                        idle_waits = 0
                        continue
                else:
                    await asyncio.sleep(stream_poll_delay(idle_waits))
                if progressed:
                    continue
                async with self._reader() as uow:
                    active = await uow.run.get_active(session_id) is not None
                idle_waits = next_idle_waits(idle_waits, active=active, progressed=False)
        finally:
            if subscription is not None:
                try:
                    await subscription.close()
                except (asyncio.CancelledError, Exception) as e:
                    logger.debug(f"会话[{session_id}]关闭事件订阅: {e!r}")

    async def stop_session(self, session_id: str) -> Optional[Run]:
        """停止会话当前的运行：同一事务写入 cancelled 与终态事件，再取消执行协程并做收尾。

        没有活动运行时不做任何改动，返回 None。运行中尚未进入模型历史的补充消息保持已受理未消费，可明确重新发起。
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
                if result is not None and self._skills is not None:
                    await self._skills.cancel_run(active.id)
                return result
            starting = pending_starts().get(active.id)
            if starting is not None:
                starting.cancelled = True
            task = await self._get_task(active.id)
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
        if run is not None and self._skills is not None:
            await self._skills.cancel_run(active.id)
        if run is not None and runner is not None and hasattr(runner, "stop_processes"):
            await runner.stop_processes(active.id)
        return run

    async def compact_session(self, session_id: str) -> ManualCompaction:
        async with compacting(session_id):
            try:
                async with asyncio.timeout(MANUAL_COMPACT_TIMEOUT_SECONDS):
                    return await self._compact_session(session_id)
            except TimeoutError as exc:
                raise AppException(ErrorCode.TIMEOUT,
                                   "摘要超过总期限，请核对最新操作状态和压缩记录后再决定是否重试") from exc

    async def _compact_session(self, session_id: str) -> ManualCompaction:
        """手动压缩：在没有活动运行时把较早的轮次替换为摘要，不新建运行、不改会话状态。

        整个过程（含摘要请求）持有与 chat 共用的会话锁。会话不存在 → NotFoundError；有活动运行（running，
        或 waiting 不论提问还是审批）→ ConflictError；少于 2 轮 → skipped/no_rounds，不写事件；不做最小收益判断。
        成功时 compact(trigger=manual) 与 context(replace) 不带 run_id，与替换后的记忆在同一事务写入；
        摘要请求失败 → 502，不写事件、不改记忆。估算全部按字符计算：工具 schema 取最后一次运行的配置快照，
        窗口与输出预留取这条对话记下的数值；还没有记下时沿用上次运行快照。
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
            await self._bind_sampling(session, creating=False, model_changed=False)
            compactor = Compactor(self._llm_for_session(session), self._agent_config, label=f"会话[{session_id}]手动压缩")
            messages = copy.deepcopy(memory.get_messages())
            budget = compactor.fresh_budget()
            fixed = fixed_input_estimate(budget, messages, tools)
            if fixed.over_limit:
                raise AppException(ErrorCode.CONTEXT_LIMIT, FIXED_INPUT_GUIDANCE,
                                   details={"fixed_input": fixed.as_dict()})
            before = budget.estimate(messages, tools)

            async def load_user_events():
                async with self._uow:
                    return await self._uow.event.list(session_id, types=["message"])

            result = await compactor.compact(messages, tools, before, "manual", load_user_events, min_gain=False)
            if result.status == CompactionStatus.SKIPPED:
                return ManualCompaction(status="skipped", reason=result.reason)
            if result.status == CompactionStatus.FAILED:
                raise AppException(ErrorCode.UPSTREAM_ERROR, (
                    f"摘要请求连续 {result.usage.attempts} 次失败或返回空内容，上下文没有改变"), retryable=True)

            memory.replace(result.messages)

            async def save_memory(uow: IUnitOfWork) -> None:
                await uow.session.save_memory(session_id, AGENT_MEMORY_NAME, memory)

            compact, context = result.compact, result.context
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
        async with self._reader() as uow:
            run = await uow.run.get(run_id)
            if run is None or run.session_id != session_id:
                raise NotFoundError("运行不存在, 请核实后重试")
            events = await uow.event.list(session_id, types=["context", "turn"])
        try:
            return rebuild_request(events, run, index)
        except LookupError as e:
            raise NotFoundError(str(e)) from e

    async def shutdown(self) -> None:
        """关闭进程内的执行：撤销尚未登记的启动并取消执行协程；遗留运行由下次启动扫描处理。"""
        logger.info("正在清除所有会话任务资源并释放")
        owners = list(pending_starts().values())
        for owner in owners:
            owner.cancelled = True
        await asyncio.gather(*(owner.worker for owner in owners if owner.worker is not None), return_exceptions=True)
        task_cls = getattr(self, "_task_cls", None)
        if task_cls is not None:
            await task_cls.destroy()
        logger.info("所有会话任务资源清除成功")
