#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""单循环 Agent：一份记忆里交替进行模型请求与工具批次，没有工具调用的回复就是最终答复。

一次调用（``invoke`` 或审批续接 ``resume_approval``）的事件序列由以下类型组成：
Title、Message、Tool、Plan、Wait、Error、Done、Turn、Attempt、Context、Compact、Approval。
调用只以三种终止事件之一结束：DoneEvent（完成）、WaitEvent（等待用户回复或审批，见 end_reason）、ErrorEvent（失败）。
每轮模型请求前后各有一条 TurnEvent；记忆的每次变化都先以 ContextEvent 发出，供请求重建按序回放。
每轮请求前估算输入量：超过压缩水位先压缩（CompactEvent + ContextEvent(replace)），仍超过可用上限以 context_limit 失败。
计划模式（mode=plan）下只读工具以外的调用在执行前被拒绝，计划模式说明只在发送请求时拼到 system 消息末尾。
"""
import asyncio
import copy
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Iterator, List, Optional, Set

from app.domain.external.browser import Browser
from app.domain.external.llm import LLM, LLMRequestError, is_retryable as _is_retryable
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.models.app_config import AgentConfig, ToolPolicyConfig
from app.domain.models.event import (
    ApprovalEvent,
    ApprovalStatus,
    BaseEvent,
    CompactEvent,
    ContextEvent,
    ContextOp,
    AttemptEvent,
    AttemptReason,
    DoneEvent,
    ErrorEvent,
    MessageEvent,
    PlanEvent,
    PlanEventStatus,
    ToolEvent,
    ToolEventStatus,
    TurnEvent,
    TurnPhase,
    TurnUsage,
    WaitEvent,
    latest_plan,
)
from app.domain.models.llm import LLMUsage
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.session import SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.agents.tool_call_compat import extract_embedded_tool_calls
from app.domain.models.run import RunMode
from app.domain.services.context.budget import ContextBudget, ContextEstimate, fixed_input_estimate, FIXED_INPUT_GUIDANCE
from app.domain.services.context.compactor import CompactionStatus, Compactor
from app.domain.services.context.shaping import ResultShaper, WriteOutputFn
from app.domain.services.plan_mode import PlanModeGuard
from app.domain.services.prompts.plan_mode import PLAN_MODE_SUFFIX
from app.domain.services.prompts.system import SYSTEM_PROMPT
from app.domain.services.task_error import format_public_error_text
from app.domain.services.tool_policy import ToolPolicyGuard
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.base import BaseTool
from app.domain.services.tools.browser import BrowserTool
from app.domain.services.tools.web import WebTool
from app.domain.services.tools.deliver import DELIVER_FILES_TOOL, DeliverFileFn, DeliverTool, DeliveryResult
from app.domain.services.tools.file import FileTool
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.message import ASK_USER_TOOL, MessageTool
from app.domain.services.tools.plan import UPDATE_PLAN_TOOL, PlanTool
from app.domain.services.tools.search import SearchTool
from app.domain.services.tools.shell import ShellTool
from .base import BaseFlow
from .tool_pipeline import ToolInvocation, ToolPipeline

logger = logging.getLogger(__name__)

AGENT_MEMORY_NAME = "agent"

NOT_EXECUTED_WAITING = "未执行：等待用户回复后重新决策"
NOT_EXECUTED_STOPPED = "未执行：任务已停止"
NOT_EXECUTED_FAILED = "未执行：任务失败"
NOT_EXECUTED_APPROVAL = "未执行：同一批次中前面的调用在等待用户审批，本调用未执行，请根据审批结果重新决策"
INTERRUPTED_STOPPED = "执行中断：任务在该调用执行期间被停止，调用可能已部分生效，结果未知"
INTERRUPTED_FAILED = "执行中断：任务在该调用执行期间失败，调用可能已部分生效，结果未知"

TRUNCATION_PROMPT = (
    "[系统提示] 上一次回复超过输出长度上限被截断，已被丢弃，其中的工具调用均未执行。"
    "请缩短输出后重试：长内容分段写入文件，每次只提交必要的工具调用。"
)

# 运行中补充的用户消息：循环在每次模型请求前取出全部待处理消息
DrainFn = Callable[[], Awaitable[List[Message]]]


class RunEndReason(str, Enum):
    """一次运行的结束原因。"""
    COMPLETED = "completed"  # 模型给出没有工具调用的最终答复
    WAITING = "waiting"  # 模型提问，等待用户回复
    APPROVAL = "approval"  # 调用的策略为 ask，等待用户批准或拒绝
    MAX_ITERATIONS = "max_iterations"  # 模型请求次数达到 AgentConfig.max_iterations
    OUTPUT_TRUNCATED = "output_truncated"  # 连续两次 finish_reason == "length"
    MODEL_ERROR = "model_error"  # 不可重试的模型错误，或重试次数耗尽
    CONTEXT_LIMIT = "context_limit"  # 压缩后仍放不进窗口、摘要请求失败，或服务端拒绝超长输入且压缩无效


def build_default_tools(
        sandbox: Sandbox,
        browser: Browser,
        search_engine: SearchEngine,
        mcp_tool: MCPTool,
        a2a_tool: A2ATool,
        default_exec_dir: str = "/home/ubuntu",
        capture_screenshot=None,
) -> List[BaseTool]:
    """默认工具集；计划与交付工具由循环自己追加。default_exec_dir 是 shell_execute 省略工作目录时的默认值。"""
    return [
        FileTool(sandbox=sandbox),
        ShellTool(sandbox=sandbox, default_exec_dir=default_exec_dir),
        BrowserTool(browser=browser, capture=capture_screenshot),
        WebTool(sandbox=sandbox),
        SearchTool(search_engine=search_engine),
        MessageTool(),
        mcp_tool,
        a2a_tool,
    ]


def find_dangling_calls(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """最后一条助手消息中还没有 tool 结果的调用，按原顺序返回。"""
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") != "assistant":
            continue
        answered = {m.get("tool_call_id") for m in messages[index + 1:] if m.get("role") == "tool"}
        return [call for call in messages[index].get("tool_calls") or [] if call.get("id") not in answered]
    return []


def tool_message(call_id: str, function_name: str, result: ToolResult) -> Dict[str, Any]:
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "function_name": function_name,
        "content": result.model_dump_json(),
    }


def repair_results(
        dangling: List[Dict[str, Any]],
        status: SessionStatus,
        message: Optional[Message] = None,
        started_call_ids: Optional[Set[str]] = None,
) -> tuple[List[Dict[str, Any]], bool]:
    """悬空调用的补结果（规则见 AgentLoop.repair_dangling_calls）；返回 tool 消息与用户回复是否已作为提问结果。"""
    started_call_ids = started_call_ids or set()
    if status == SessionStatus.WAITING:
        reason = NOT_EXECUTED_WAITING
    elif status == SessionStatus.FAILED:
        reason = NOT_EXECUTED_FAILED
    else:
        reason = NOT_EXECUTED_STOPPED

    reply_consumed = False
    repaired = []
    for call in dangling:
        function_name = (call.get("function") or {}).get("name", "")
        if (status == SessionStatus.WAITING and message is not None and not reply_consumed
                and function_name == ASK_USER_TOOL):
            result = ToolResult(success=True, message="用户已回复", data={
                "reply": message.message,
                "attachments": list(message.attachments),
            })
            reply_consumed = True
        elif status != SessionStatus.WAITING and call.get("id") in started_call_ids:
            interrupted = INTERRUPTED_FAILED if status == SessionStatus.FAILED else INTERRUPTED_STOPPED
            result = ToolResult(success=False, message=interrupted)
        else:
            result = ToolResult(success=False, message=reason)
        repaired.append(tool_message(call.get("id"), function_name, result))
    return repaired, reply_consumed


def normalize_assistant_message(raw: Dict[str, Any]) -> Dict[str, Any]:
    """保留全部工具调用；缺失的 ID 在这里生成一次，随消息写入记忆后不再改变。"""
    message = extract_embedded_tool_calls(raw)
    normalized: Dict[str, Any] = {"role": "assistant", "content": message.get("content")}
    if message.get("reasoning_content"):
        normalized["reasoning_content"] = message["reasoning_content"]
    calls = []
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        arguments = function.get("arguments")
        if arguments is None:
            arguments = "{}"
        elif not isinstance(arguments, str):
            arguments = json.dumps(arguments, ensure_ascii=False)
        calls.append({
            "id": call.get("id") or f"call_{uuid.uuid4().hex}",
            "type": "function",
            "function": {"name": function.get("name") or "", "arguments": arguments},
        })
    if calls:
        normalized["tool_calls"] = calls
    return normalized


def _user_content(message: Message) -> str:
    if not message.attachments:
        return message.message
    listed = "\n".join(f"- {path}" for path in message.attachments)
    return f"{message.message}\n\n用户上传的附件（沙箱路径）：\n{listed}"


def _attempt_reason(error: BaseException) -> str:
    if isinstance(error, LLMRequestError) and error.reason:
        return error.reason
    if _is_retryable(error):
        return AttemptReason.TRANSPORT.value
    return AttemptReason.MODEL_ERROR.value


def _add_optional(total: Optional[int], value: Optional[int]) -> Optional[int]:
    if value is None:
        return total
    return (total or 0) + value


@dataclass
class _ModelTurn:
    """一轮的进行状态：一次模型请求（含重试）的结果与随后的工具批次。

    response 与 failure 至多一个有值，truncated 表示应丢弃并重试。
    """
    index: int = 0
    executed: List[str] = field(default_factory=list)  # 有 called 事件的调用
    tools_ms: int = 0
    response: Optional[Dict[str, Any]] = None
    truncated: bool = False
    overflow: bool = False  # 服务端以上下文超长拒绝
    failure: Optional[RunEndReason] = None
    error: str = ""
    finish_reason: Optional[str] = None
    attempts: int = 0
    model_ms: int = 0
    ttft_ms: Optional[int] = None
    usage: TurnUsage = field(default_factory=TurnUsage)

    def add_usage(self, usage: Optional[LLMUsage]) -> None:
        if usage is None:
            return
        self.usage = TurnUsage(
            prompt_tokens=_add_optional(self.usage.prompt_tokens, usage.prompt_tokens),
            completion_tokens=_add_optional(self.usage.completion_tokens, usage.completion_tokens),
            cached_tokens=_add_optional(self.usage.cached_tokens, usage.cached_tokens),
            reasoning_tokens=_add_optional(self.usage.reasoning_tokens, usage.reasoning_tokens),
        )


@dataclass
class _Inflight:
    """进行中的那一次模型请求。停止时用它补失败尝试，请求返回后清空。"""
    turn: int
    attempt: int
    started: float
    chars: int = 0
    ttft_ms: Optional[int] = None


class AgentLoop(BaseFlow):
    """替代规划器 + 执行器双循环的单循环。"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            llm: LLM,
            agent_config: AgentConfig,
            session_id: str,
            tools: List[BaseTool],
            deliver_file: Optional[DeliverFileFn] = None,
            write_output: Optional[WriteOutputFn] = None,
            system_prompt: str = SYSTEM_PROMPT,
            retry_interval: float = 1.0,
            tool_policy: Optional[ToolPolicyConfig] = None,
            mode: RunMode = RunMode.NORMAL,
            project_prompt: str = "",
    ) -> None:
        """write_output 把超长工具结果的完整内容写入沙箱，由运行器注入；为空时超长结果只截断。

        tool_policy 为空时用默认策略表（MCP 与 A2A 需要批准，其余直接执行）。
        mode 是运行模式；运行器在记录配置快照前按运行行改写（见 mode 属性）。
        """
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._config = agent_config
        self._session_id = session_id
        self._system_prompt = system_prompt
        self.project_prompt = project_prompt
        self.request_system_prompt: Optional[str] = None
        self._retry_interval = retry_interval
        self._memory: Optional[Memory] = None
        self._pending_context: List[ContextEvent] = []
        self._open_turn: Optional[_ModelTurn] = None
        self._last_completed: Optional[TurnEvent] = None
        self._running = False
        self.end_reason: Optional[RunEndReason] = None
        self._completion_feedbacks = 0
        self._delivery_required = False
        self._delivery_state = None
        self._delivery_failures = set()
        self._plan_changed = False
        self.model_requests = 0  # 本次调用已发出的模型请求数（含重试与摘要请求）
        self.budget = ContextBudget(
            context_window=llm.context_window,
            max_tokens=llm.max_tokens,
            safety_ratio=agent_config.context_safety_ratio,
            watermark_ratio=agent_config.compact_watermark,
        )
        self._capacity_error: Optional[str] = None
        self._estimate: Optional[ContextEstimate] = None
        self._publish_delta: Optional[Callable[[int, int, str], Awaitable[None]]] = None
        self._inflight: Optional[_Inflight] = None
        self._deltas_closed = False
        self.pending_approval: Optional[ApprovalEvent] = None  # 以 APPROVAL 结束时等待回复的审批请求
        self._session_status: Optional[SessionStatus] = None
        self._compactor = Compactor(llm, agent_config, retry_interval, label=f"会话[{session_id}]")

        self.plan_tool = PlanTool()
        toolkits = [*tools, self.plan_tool]
        if deliver_file is not None:
            toolkits.append(DeliverTool(deliver_file))
        self.pipeline = ToolPipeline(toolkits)
        # 计划模式的检查在策略之前：被拒绝的调用不会进入审批
        self._plan_guard = PlanModeGuard()
        self.pipeline.add_before(self._plan_guard)
        self.pipeline.add_before(ToolPolicyGuard(tool_policy))
        self._mode = RunMode.NORMAL
        self.mode = mode
        self.pipeline.add_after(self._emit_plan_event)
        self.pipeline.add_after(self._record_delivery_state)
        self.pipeline.add_after(self._emit_delivery_message)
        # 整形放在最后：前面的处理函数读的是工具的原始结果
        self.pipeline.add_after(ResultShaper(agent_config.tool_result_max_chars, write_output))

    @property
    def done(self) -> bool:
        return not self._running

    @property
    def memory(self) -> Optional[Memory]:
        return self._memory

    @property
    def mode(self) -> RunMode:
        return self._mode

    @mode.setter
    def mode(self, value: RunMode) -> None:
        self._mode = RunMode(value)
        self._plan_guard.enabled = self._mode == RunMode.PLAN

    def _with_mode_suffix(self, system_prompt: str) -> str:
        return system_prompt + PLAN_MODE_SUFFIX if self._mode == RunMode.PLAN else system_prompt

    def _request_messages(self) -> List[Dict[str, Any]]:
        """基础 system 留在记忆，运行冻结的项目段/模式只进入实际请求。"""
        messages = self._memory.get_messages()
        if not messages or messages[0].get("role") != "system":
            return messages
        system = self.request_system_prompt or self._with_mode_suffix(str(messages[0].get("content") or "") + self.project_prompt)
        return [{**messages[0], "content": system}, *messages[1:]]

    async def config_snapshot(self) -> Dict[str, Any]:
        """本次运行的配置快照：模型参数、Agent 配置、运行模式、实际发送的系统提示词全文（计划模式含后缀）
        与工具 schema，供请求重建使用。"""
        await self._ensure_memory()
        messages = self._memory.get_messages()
        system_prompt = self._system_prompt
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0].get("content")
        return {
            "model_name": self._llm.model_name,
            "temperature": self._llm.temperature,
            "max_tokens": self._llm.max_tokens,
            "context_window": self._llm.context_window,
            "thinking": getattr(self._llm, "thinking", None),
            "reasoning": getattr(self._llm, "reasoning_id", None),
            "reasoning_effort": getattr(self._llm, "reasoning_effort", None),
            "keep_reasoning": getattr(self._llm, "keep_reasoning", False),
            "tool_batching": getattr(self._llm, "tool_batching", "disabled"),
            "agent_config": self._config.model_dump(mode="json"),
            "mode": self._mode.value,
            "system_prompt": self.request_system_prompt or self._with_mode_suffix(system_prompt + self.project_prompt),
            "project_prompt": self.project_prompt,
            "tools": copy.deepcopy(self.pipeline.schemas()),
        }

    # ---- 运行 ----

    async def invoke(
            self,
            message: Message,
            drain_injected_messages: Optional[DrainFn] = None,
            prior_status: Optional[SessionStatus] = None,
            first_turn_index: int = 1,
    ) -> AsyncGenerator[BaseEvent, None]:
        """prior_status 是本条消息到达前会话所处的状态，决定悬空调用如何补结果；为空时读会话行。

        first_turn_index 是本次调用第一轮的序号：续接同一运行时由运行器传入，使序号在运行内连续。
        """
        self._begin()
        try:
            async for event in self._run(message, drain_injected_messages, prior_status, first_turn_index):
                yield event
        finally:
            self._running = False

    async def resume_approval(
            self,
            call_id: str,
            decision: ApprovalStatus,
            drain_injected_messages: Optional[DrainFn] = None,
            first_turn_index: int = 1,
    ) -> AsyncGenerator[BaseEvent, None]:
        """审批回复后续接：批准时经管线执行该调用一次，拒绝时回填“用户拒绝执行”；
        同一批次中它之后仍悬空的调用补为未执行，然后照常请求模型。"""
        self._begin()
        try:
            async for event in self._resume(call_id, decision, drain_injected_messages, first_turn_index):
                yield event
        finally:
            self._running = False

    def _begin(self) -> None:
        self._running = True
        self.end_reason = None
        self.model_requests = 0
        self._inflight = None
        self._deltas_closed = False
        self.pending_approval = None
        self._completion_feedbacks=0
        self._delivery_state=None
        self._delivery_failures.clear()
        self._delivery_required=False
        self._plan_changed=False

    async def _load(self) -> List[BaseEvent]:
        """读会话与已有工具、计划事件，准备记忆与计划工具；返回这些事件。"""
        async with self._uow:
            session = await self._uow.session.get_by_id(self._session_id)
            history = await self._uow.event.list(self._session_id, types=["tool", "plan"])
        if not session:
            raise ValueError(f"会话[{self._session_id}]不存在, 请核实后尝试")
        await self._ensure_memory()
        if self.plan_tool.latest_plan is None:
            self.plan_tool.latest_plan = latest_plan(history)
        self._session_status = session.status
        return history

    async def _resume(
            self,
            call_id: str,
            decision: ApprovalStatus,
            drain: Optional[DrainFn],
            first_turn_index: int,
    ) -> AsyncGenerator[BaseEvent, None]:
        await self._load()
        dangling = find_dangling_calls(self._memory.get_messages())
        position = next((i for i, call in enumerate(dangling) if call.get("id") == call_id), None)
        if position is None:
            raise ValueError(f"待审批的调用[{call_id}]不在模型历史的悬空调用中，无法续接")
        call = dangling[position]
        logger.info(f"会话[{self._session_id}] 审批续接 call={call_id} decision={decision.value}")
        invocation = ToolInvocation(
            call_id=call_id,
            function_name=(call.get("function") or {}).get("name", ""),
            raw_arguments=(call.get("function") or {}).get("arguments", ""),
            approval=decision.value,
        )
        async for event in self._execute(invocation):
            yield event
        if invocation.suspended:
            raise RuntimeError(f"已审批的调用[{call_id}]再次被挂起")
        async for event in self._skip_calls(dangling[position + 1:], NOT_EXECUTED_APPROVAL):
            yield event
        async for event in self._loop(drain, first_turn_index):
            yield event

    async def _run(
            self,
            message: Message,
            drain: Optional[DrainFn],
            prior_status: Optional[SessionStatus],
            first_turn_index: int,
    ) -> AsyncGenerator[BaseEvent, None]:
        history = await self._load()
        self._delivery_required=bool(re.search(r'(交付|下载|deliver).{0,25}(文件|file)|(文件|file).{0,25}(交付|下载|deliver)',message.message or '', re.I)) and self.mode != RunMode.PLAN

        started = {
            e.tool_call_id for e in history
            if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLING
        }
        status = prior_status if prior_status is not None else self._session_status
        reply_consumed = await self.repair_dangling_calls(status, message, started)
        for event in self._take_context():
            yield event
        if not reply_consumed:
            # 新用户消息开始新的一问。关闭思考时删除此前的思考内容；开启思考且厂商要求跨问回放时保留。
            # 回复提问属于同一问，不删除。
            if not getattr(self._llm, "keep_reasoning", False):
                self._strip_reasoning()
            await self._add_messages([{"role": "user", "content": _user_content(message)}])
        for event in self._take_context():
            yield event
        logger.info(f"会话[{self._session_id}] Agent循环接收消息: {message.message[:50]}...")
        async for event in self._loop(drain, first_turn_index):
            yield event

    async def _loop(self, drain: Optional[DrainFn], first_turn_index: int) -> AsyncGenerator[BaseEvent, None]:
        """模型请求与工具批次交替，直到完成、等待（提问或审批）或失败。"""
        truncations = 0
        overflow_compacted = False
        index = first_turn_index - 1
        while True:
            if drain is not None:
                injected = await drain()
                if injected:
                    logger.info(f"会话[{self._session_id}] 追加运行中补充的消息 {len(injected)} 条")
                    await self._add_messages([{"role": "user", "content": _user_content(m)} for m in injected])
                    for event in self._take_context():
                        yield event

            if self.model_requests >= self._config.max_iterations:
                yield self._fail(RunEndReason.MAX_ITERATIONS,
                                 f"模型请求次数达到本次运行上限 {self._config.max_iterations}")
                return
            async for event in self._ensure_capacity():
                yield event
            if self._capacity_error is not None:
                yield self._fail(RunEndReason.CONTEXT_LIMIT, self._capacity_error)
                return
            index += 1
            turn = self._open_turn = _ModelTurn(index=index)
            yield TurnEvent(phase=TurnPhase.STARTED, index=index, context_window=self._llm.context_window,
                            context_estimate=self._estimate.as_dict())
            async for event in self._request_model(turn):
                yield event
            if turn.overflow:
                # 服务端以上下文超长拒绝：压缩一次后重新请求；压缩无效或再次被拒则失败
                yield self._turn_completed(turn, error="context_overflow")
                if overflow_compacted:
                    yield self._fail(RunEndReason.CONTEXT_LIMIT, "压缩后模型服务仍以上下文超长拒绝请求")
                    return
                overflow_compacted = True
                async for event in self._ensure_capacity(force=True):
                    yield event
                if self._capacity_error is not None:
                    yield self._fail(RunEndReason.CONTEXT_LIMIT, self._capacity_error)
                    return
                continue
            overflow_compacted = False
            if turn.failure is not None:
                yield self._turn_completed(turn, error=turn.failure.value)
                yield self._fail(turn.failure, turn.error)
                return
            if turn.truncated:
                yield self._turn_completed(turn)
                truncations += 1
                if truncations > 1:
                    yield self._fail(RunEndReason.OUTPUT_TRUNCATED, "模型输出连续两次超过长度上限被截断")
                    return
                await self._add_messages([{"role": "user", "content": TRUNCATION_PROMPT}])
                for event in self._take_context():
                    yield event
                continue
            truncations = 0

            assistant = turn.response
            await self._add_messages([assistant])
            for event in self._take_context():
                yield event
            content = (assistant.get("content") or "").strip()
            calls = assistant.get("tool_calls") or []
            if not calls and self.mode != RunMode.PLAN:
                issues=[]
                if (self._delivery_required and self._delivery_state != 'complete') or self._delivery_failures:
                    issues.append('文件交付尚未完整成功；核对工具结果，只补交失败项')
                plan=self.plan_tool.latest_plan
                if self._plan_changed and plan and any(not step.done for step in plan.steps):
                    issues.append('当前计划还有未完成条目；完成后更新计划，或明确说明未完成原因')
                if issues and self._completion_feedbacks < 1:
                    self._completion_feedbacks+=1
                    yield self._turn_completed(turn)
                    await self._add_messages([{'role':'user','content':'结束前一致性核对：'+'；'.join(issues)+'。不能把路径、计划或部分成功当成全部完成。无法补齐时如实交代缺口。'}])
                    for event in self._take_context():
                        yield event
                    continue
                if issues:
                    content += '\n\n执行记录仍有未完成项：'+'；'.join(issues)+'。请以上述工具事实为准。'
            if content:
                yield MessageEvent(role="assistant", message=content, attempt=turn.attempts)
            if not calls:
                yield self._turn_completed(turn)
                self.end_reason = RunEndReason.COMPLETED
                yield DoneEvent()
                return

            browser_writes = {'browser_navigate', 'browser_restart', 'browser_click', 'browser_input',
                              'browser_move_mouse', 'browser_press_key', 'browser_select_option',
                              'browser_scroll_up', 'browser_scroll_down', 'browser_console_exec'}
            fail_fast = any(c['function']['name'] in browser_writes for c in calls)
            for position, call in enumerate(calls):
                invocation = ToolInvocation(
                    call_id=call["id"],
                    function_name=call["function"]["name"],
                    raw_arguments=call["function"]["arguments"],
                )
                if invocation.function_name == ASK_USER_TOOL and await self.pipeline.check(invocation) is None:
                    # 提问之后的调用留待续接时由 repair_dangling_calls 补结果
                    yield MessageEvent(role="assistant", message=str(invocation.arguments.get("text", "")),
                                       attempt=turn.attempts)
                    yield self._turn_completed(turn)
                    self.end_reason = RunEndReason.WAITING
                    yield WaitEvent()
                    return
                async for event in self._execute(invocation, turn):
                    yield event
                if invocation.suspended:
                    # 该调用与之后的调用留待审批回复时由 resume_approval 执行或补结果
                    self.pending_approval = invocation.suspend_event
                    yield self._turn_completed(turn)
                    self.end_reason = RunEndReason.APPROVAL
                    yield WaitEvent()
                    return
                if fail_fast and invocation.result is not None and not invocation.result.success:
                    async for event in self._skip_calls(calls[position+1:],
                            '本批次前序调用失败，依赖状态不再可靠；该调用未执行。请根据结果重新决策。', turn):
                        yield event
                    break
            yield self._turn_completed(turn)

    async def _skip_calls(self, calls, reason, turn=None):
        """跳过仍保留完整 call/result 配对与 called 事件，不执行任何工具或后处理副作用。"""
        for call in calls:
            function = call.get('function') or {}
            invocation = ToolInvocation(call_id=call['id'], function_name=function.get('name', ''),
                raw_arguments=function.get('arguments', ''), denied_by='batch', duration_ms=0)
            await self.pipeline.check(invocation)
            result = ToolResult(success=False, message=reason, data={'executed':False})
            await self._add_messages([tool_message(invocation.call_id, invocation.function_name, result)])
            for context in self._take_context():
                yield context
            if turn is not None:
                turn.executed.append(invocation.call_id)
            yield invocation.tool_event(ToolEventStatus.CALLED, result)

    async def _execute(self, invocation: ToolInvocation,
                       turn: Optional[_ModelTurn] = None) -> AsyncGenerator[BaseEvent, None]:
        """经管线执行一次调用；结果先写记忆再发 called，在 called 之后停止时续接不会把已执行的调用补成未执行。"""
        async for event in self.pipeline.run(invocation):
            if isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED \
                    and event.tool_call_id == invocation.call_id:
                await self._add_messages([
                    tool_message(invocation.call_id, invocation.function_name, invocation.result),
                ])
                for context in self._take_context():
                    yield context
                if turn is not None:
                    turn.executed.append(invocation.call_id)
                    turn.tools_ms += invocation.duration_ms or 0
            yield event

    async def _on_model_delta(self, text: str) -> None:
        """流式文本增量：计入本次尝试的字符数，并经运行器推到通知通道。推理内容不会进到这里。"""
        if self._deltas_closed or not text:
            return
        inflight = self._inflight
        if inflight is None:
            return
        if inflight.ttft_ms is None:
            inflight.ttft_ms = max(0, int((time.monotonic() - inflight.started) * 1000))
        inflight.chars += len(text)
        if self._publish_delta is None:
            return
        try:
            await self._publish_delta(inflight.turn, inflight.attempt, text)
        except Exception as e:
            logger.warning(f"会话[{self._session_id}] 文本增量发布失败: {e}")

    def _attempt_event(self, turn: _ModelTurn, reason: str, retried: bool) -> AttemptEvent:
        chars = self._inflight.chars if self._inflight is not None else 0
        self._inflight = None
        return AttemptEvent(
            turn=turn.index,
            attempt=turn.attempts,
            reason=AttemptReason(reason),
            chars=chars,
            retried=retried,
        )

    def open_attempt_event(self) -> Optional[AttemptEvent]:
        """用户停止时，若有尚未返回的模型请求，给出要落库的失败尝试。调用后不再推送增量。"""
        self._deltas_closed = True
        inflight = self._inflight
        if inflight is None:
            return None
        return AttemptEvent(
            turn=inflight.turn,
            attempt=inflight.attempt,
            reason=AttemptReason.CANCELLED,
            chars=inflight.chars,
            retried=False,
        )

    async def _request_model(self, turn: _ModelTurn) -> AsyncGenerator[BaseEvent, None]:
        """发出一次模型请求；传输类错误、流中断与空回复按 max_retries 重试，每次尝试都计入 max_iterations。

        失败的尝试产出 AttemptEvent，不写入记忆。没有 finish_reason 的结果视为流中断。
        """
        while True:
            if self.model_requests >= self._config.max_iterations:
                turn.failure = RunEndReason.MAX_ITERATIONS
                turn.error = f"模型请求次数达到本次运行上限 {self._config.max_iterations}"
                return
            self.model_requests += 1
            turn.attempts += 1
            started = time.monotonic()
            self._inflight = _Inflight(turn=turn.index, attempt=turn.attempts, started=started)
            messages, tools = self._request_messages(), self.pipeline.schemas()
            try:
                result = await self._llm.invoke(messages=messages, tools=tools, on_delta=self._on_model_delta)
                if not result.finish_reason:
                    raise LLMRequestError(
                        "模型流在结束原因前结束",
                        retryable=True,
                        reason=AttemptReason.STREAM_INTERRUPTED.value,
                    )
            except asyncio.CancelledError:
                self._inflight = None
                raise
            except Exception as e:
                turn.model_ms += int((time.monotonic() - started) * 1000)
                logger.warning(f"会话[{self._session_id}] 模型请求失败（第 {turn.attempts} 次）: {e}")
                if isinstance(e, LLMRequestError) and e.context_exceeded:
                    self._inflight = None
                    turn.overflow = True
                    turn.error = str(e)
                    return
                will_retry = _is_retryable(e) and turn.attempts < self._config.max_retries
                yield self._attempt_event(turn, _attempt_reason(e), will_retry)
                if not will_retry:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = str(e) or type(e).__name__
                    return
                await asyncio.sleep(self._retry_interval)
                continue

            turn.model_ms += int((time.monotonic() - started) * 1000)
            turn.add_usage(result.usage)
            self.budget.record_usage(messages, tools, result.usage.prompt_tokens if result.usage else None)
            if result.ttft_ms is not None:
                turn.ttft_ms = result.ttft_ms
            elif self._inflight is not None and self._inflight.ttft_ms is not None:
                turn.ttft_ms = self._inflight.ttft_ms
            turn.finish_reason = result.finish_reason
            if result.finish_reason == "length":
                logger.warning(f"会话[{self._session_id}] 模型输出被截断，丢弃本次响应")
                self._inflight = None
                turn.truncated = True
                return
            response = normalize_assistant_message(result.message)
            if getattr(self._llm, "keep_reasoning", False):
                # 合法思考响应可以没有推理片段；空字段与旧历史丢失推理不同。
                response.setdefault("reasoning_content", "")
            if not (response.get("content") or "").strip() and not response.get("tool_calls"):
                logger.warning(f"会话[{self._session_id}] 模型返回空回复（第 {turn.attempts} 次）")
                will_retry = turn.attempts < self._config.max_retries
                yield self._attempt_event(turn, AttemptReason.EMPTY.value, will_retry)
                if not will_retry:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = f"模型连续 {turn.attempts} 次返回空回复"
                    return
                await asyncio.sleep(self._retry_interval)
                continue
            self._inflight = None
            turn.response = response
            return

    @staticmethod
    def _completion(turn: _ModelTurn, error: Optional[str] = None) -> TurnEvent:
        return TurnEvent(
            phase=TurnPhase.COMPLETED,
            index=turn.index,
            model_ms=turn.model_ms,
            attempts=turn.attempts,
            ttft_ms=turn.ttft_ms,
            usage=turn.usage.model_copy(),
            finish_reason=turn.finish_reason,
            tool_call_ids=list(turn.executed),
            tools_ms=turn.tools_ms,
            error=error,
        )

    def _turn_completed(self, turn: _ModelTurn, error: Optional[str] = None) -> TurnEvent:
        self._open_turn = None
        self._last_completed = self._completion(turn, error)
        return self._last_completed.model_copy(deep=True)

    def turn_snapshot(self, index: int, error: str) -> Optional[TurnEvent]:
        """运行被外部置为终态时补写第 index 轮的 completed：本轮仍在进行时按已发生的尝试与用量生成
        （带 error）；本轮的 completed 已产生但未写入时返回它。其他情况返回 None。"""
        if self._open_turn is not None and self._open_turn.index == index:
            event = self._completion(self._open_turn, error)
            inflight = self._inflight
            if inflight is not None and inflight.turn == index:
                event.model_ms = (event.model_ms or 0) + max(0, int((time.monotonic() - inflight.started) * 1000))
                if event.ttft_ms is None and inflight.ttft_ms is not None:
                    event.ttft_ms = inflight.ttft_ms
            return event
        if self._last_completed is not None and self._last_completed.index == index:
            return self._last_completed.model_copy(deep=True)
        return None

    def _fail(self, reason: RunEndReason, detail: str) -> ErrorEvent:
        self.end_reason = reason
        logger.warning(f"会话[{self._session_id}] Agent循环失败结束 reason={reason.value}: {detail}")
        if reason == RunEndReason.MODEL_ERROR:
            text = format_public_error_text(detail)
        else:
            text = f"{detail}，任务未完成。可在本任务中重试。"
        return ErrorEvent(error=f"{text}（原因：{reason.value}）",
                          context_estimate=self._estimate.as_dict() if reason == RunEndReason.CONTEXT_LIMIT and self._estimate else None,
                          fixed_input_exceeded=reason == RunEndReason.CONTEXT_LIMIT and FIXED_INPUT_GUIDANCE in detail)

    # ---- 悬空调用 ----

    async def repair_dangling_calls(
            self,
            status: SessionStatus,
            message: Optional[Message] = None,
            started_call_ids: Optional[Set[str]] = None,
    ) -> bool:
        """为上一次运行留下的无结果调用补结果，保证之后的模型请求不含悬空调用。

        会话处于 waiting 时，第一个悬空的提问调用以用户回复为结果，其余调用补为“等待用户回复后重新决策”；
        failed 补为“任务失败”；其他状态（cancelled、interrupted，以及无法判断时）补为“任务已停止”。
        started_call_ids 中的调用已发出 calling 事件、可能已在沙箱产生副作用，补为“执行中断，结果未知”。
        返回用户回复是否已作为提问结果写入（是则调用方不再重复追加用户消息）。
        """
        await self._ensure_memory()
        dangling = find_dangling_calls(self._memory.get_messages())
        if not dangling:
            return False
        repaired, reply_consumed = repair_results(dangling, status, message, started_call_ids)
        logger.info(f"会话[{self._session_id}] 为 {len(repaired)} 个悬空调用补结果（{status.value}）")
        await self._add_messages(repaired)
        return reply_consumed

    # ---- 执行后处理 ----

    async def _emit_plan_event(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if (invocation.function_name == UPDATE_PLAN_TOOL and not invocation.short_circuited
                and result.success and self.plan_tool.latest_plan is not None):
            self._plan_changed=True
            invocation.events.append(PlanEvent(
                status=PlanEventStatus.UPDATED,
                plan=self.plan_tool.latest_plan.model_copy(deep=True),
            ))
        return result

    async def _record_delivery_state(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if invocation.function_name == 'browser_screenshot' and result.success and isinstance(result.data, dict):
            file = result.data.get('file') or {}
            if file:
                self._delivery_state = 'complete'
                project = file.get('project_persistence') or {}
                if project.get('state') == 'failed':
                    self._delivery_failures.add(file.get('filepath', '截图'))
        if invocation.function_name == DELIVER_FILES_TOOL and isinstance(result.data, DeliveryResult):
            self._delivery_state = result.data.state
            for item in result.data.items:
                if not item.success or (item.project and item.project.get('state') == 'failed'):
                    self._delivery_failures.add(item.path)
                else:
                    self._delivery_failures.discard(item.path)
        return result

    async def _emit_delivery_message(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if invocation.function_name == 'browser_screenshot' and result.success and isinstance(result.data, dict):
            file_data = result.data.get('file')
            if file_data:
                from app.domain.models.file import File
                file = File.model_validate(file_data)
                message = '截图已保存'
                if (file.project_persistence or {}).get('state') == 'failed':
                    message += '；可下载，但未保存到项目'
                invocation.events.append(MessageEvent(message=message, attachments=[file]))
            return result
        if invocation.function_name != DELIVER_FILES_TOOL or not isinstance(result.data, DeliveryResult):
            return result
        files = result.data.files
        if files:
            names = "、".join(file.filename or file.filepath for file in files)
            message = result.data.note or f"已交付文件：{names}"
            failed=[item.path for item in result.data.items if not item.success]
            if failed:
                message += '；未交付：'+'、'.join(failed)
            partial = [item for item in result.data.items if item.project and item.project.get('state') == 'failed']
            if partial:
                message += '；交付可下载，但未保存到项目：' + '、'.join(item.path for item in partial)
            invocation.events.append(MessageEvent(
                role="assistant",
                message=message,
                attachments=files,
            ))
        return result

    # ---- 记忆 ----

    async def _ensure_memory(self) -> None:
        if self._memory is None:
            async with self._uow:
                self._memory = await self._uow.session.get_memory(self._session_id, AGENT_MEMORY_NAME)

    def _take_context(self) -> Iterator[ContextEvent]:
        """取出尚未发出的上下文事件；调用方在下一次模型请求前把它们全部发出。"""
        pending, self._pending_context = self._pending_context, []
        return iter(pending)

    def _strip_reasoning(self) -> None:
        self._memory.strip_reasoning()
        self.budget.reset()
        self._pending_context.append(ContextEvent(op=ContextOp.STRIP_REASONING))

    # ---- 容量与压缩 ----

    def estimate_context(self) -> ContextEstimate:
        """下一次模型请求的输入量估算（四部分与上限）。"""
        return self.budget.estimate(self._request_messages(), self.pipeline.schemas())

    async def _ensure_capacity(self, force: bool = False) -> AsyncGenerator[BaseEvent, None]:
        """请求前的容量检查：超过水位（或 force）先压缩并重新估算；仍超过可用上限时置 _capacity_error。

        结束后 _estimate 是本轮请求的估算，随 turn(started) 记录。
        """
        self._capacity_error = None
        estimate = self.estimate_context()
        fixed = fixed_input_estimate(self.budget, self._request_messages(), self.pipeline.schemas())
        if fixed.over_limit:
            self._estimate = estimate
            self._capacity_error = f"{FIXED_INPUT_GUIDANCE}（固定输入 {fixed.total}，可用上限 {fixed.limit} tokens）"
            return
        if force or estimate.over_watermark:
            trigger = "overflow" if force else "watermark"
            logger.info(f"会话[{self._session_id}] 上下文估算 {estimate.total}/{estimate.limit} tokens，"
                        f"水位 {estimate.watermark}，开始压缩（{trigger}）")
            compacted = False
            async for event in self._compact_history(estimate, trigger):
                compacted = compacted or isinstance(event, CompactEvent)
                yield event
            if self._capacity_error is not None:
                return
            estimate = self.estimate_context()
            if force and not compacted:
                self._capacity_error = "模型服务以上下文超长拒绝请求，且没有可压缩的较早历史"
                return
        self._estimate = estimate
        if estimate.over_limit:
            self._capacity_error = (f"上下文估算 {estimate.total} tokens 超过可用输入上限 {estimate.limit} "
                                    f"（窗口 {estimate.context_window}，输出预留 {estimate.max_tokens}）")

    async def _compact_history(self, before: ContextEstimate, trigger: str) -> AsyncGenerator[BaseEvent, None]:
        """把保留区之前的历史替换为摘要，并重新注入其中的用户原文；摘要失败时置 _capacity_error，不改记忆。

        先替换并保存记忆，再产出 compact 与 context(replace) 事件由运行器写入；最小收益判断只在水位触发时启用。
        """
        async def load_user_events():
            async with self._uow:
                return await self._uow.event.list(self._session_id, types=["message"])

        result = await self._compactor.compact(
            self._request_messages(), self.pipeline.schemas(), before, trigger, load_user_events,
            min_gain=trigger == "watermark")
        self.model_requests += result.usage.attempts
        if result.status == CompactionStatus.SKIPPED:
            return
        if result.status == CompactionStatus.FAILED:
            self._capacity_error = f"上下文压缩的摘要请求连续 {result.usage.attempts} 次失败或返回空内容，未压缩历史"
            return
        self._memory.replace(result.messages)
        self.budget.reset()
        self._pending_context.append(result.context)
        async with self._uow:
            await self._uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, self._memory)
        yield result.compact
        for event in self._take_context():
            yield event

    async def _add_messages(self, messages: List[Dict[str, Any]]) -> None:
        await self._ensure_memory()
        if self._memory.empty:
            # system 消息不记为上下文事件：它的全文在运行的 config_snapshot 里
            self._memory.add_message({"role": "system", "content": self._system_prompt})
        self._memory.add_messages(messages)
        self._pending_context.append(ContextEvent(op=ContextOp.APPEND, messages=copy.deepcopy(messages)))
        async with self._uow:
            await self._uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, self._memory)
