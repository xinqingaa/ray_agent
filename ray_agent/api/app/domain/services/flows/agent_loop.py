#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""单循环 Agent：一份记忆里交替进行模型请求与工具批次，没有工具调用的回复就是最终答复。

一次调用（``invoke``）的事件序列由以下类型组成：Title、Message、Tool、Plan、Wait、Error、Done、Turn、Context、Compact。
调用只以三种终止事件之一结束：DoneEvent（完成）、WaitEvent（等待用户回复）、ErrorEvent（失败）。
每轮模型请求前后各有一条 TurnEvent；记忆的每次变化都先以 ContextEvent 发出，供请求重建按序回放。
每轮请求前估算输入量：超过压缩水位先压缩（CompactEvent + ContextEvent(replace)），仍超过可用上限以 context_limit 失败。
"""
import asyncio
import copy
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Iterator, List, Optional, Set

from app.domain.external.browser import Browser
from app.domain.external.llm import LLM, LLMRequestError
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.models.app_config import AgentConfig
from app.domain.models.event import (
    BaseEvent,
    CompactEvent,
    CompactUsage,
    ContextEvent,
    ContextOp,
    DoneEvent,
    ErrorEvent,
    MessageEvent,
    PlanEvent,
    PlanEventStatus,
    TitleEvent,
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
from app.domain.models.session import DEFAULT_SESSION_TITLE, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.agents.tool_call_compat import extract_embedded_tool_calls
from app.domain.services.context.budget import (
    ContextBudget,
    ContextEstimate,
    estimate_message,
    estimate_text,
    raw_parts,
)
from app.domain.services.context.compaction import (
    MIN_GAIN_RATIO,
    match_events,
    plan_compaction,
    render_transcript,
    select_reinjection,
    summary_message,
    user_origins,
)
from app.domain.services.context.shaping import ResultShaper, WriteOutputFn
from app.domain.services.prompts.compact import COMPACT_PROMPT
from app.domain.services.prompts.system import SYSTEM_PROMPT
from app.domain.services.task_error import format_public_error_text
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.base import BaseTool
from app.domain.services.tools.browser import BrowserTool
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
TITLE_MAX_CHARS = 30

NOT_EXECUTED_WAITING = "未执行：等待用户回复后重新决策"
NOT_EXECUTED_STOPPED = "未执行：任务已停止"
NOT_EXECUTED_FAILED = "未执行：任务失败"
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
) -> List[BaseTool]:
    """默认工具集；计划与交付工具由循环自己追加。"""
    return [
        FileTool(sandbox=sandbox),
        ShellTool(sandbox=sandbox),
        BrowserTool(browser=browser),
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


def _is_retryable(error: BaseException) -> bool:
    if isinstance(error, LLMRequestError):
        return error.retryable
    return isinstance(error, (ConnectionError, TimeoutError, asyncio.TimeoutError))


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
    ) -> None:
        """write_output 把超长工具结果的完整内容写入沙箱，由运行器注入；为空时超长结果只截断。"""
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._config = agent_config
        self._session_id = session_id
        self._system_prompt = system_prompt
        self._retry_interval = retry_interval
        self._memory: Optional[Memory] = None
        self._pending_context: List[ContextEvent] = []
        self._open_turn: Optional[_ModelTurn] = None
        self._last_completed: Optional[TurnEvent] = None
        self._running = False
        self.end_reason: Optional[RunEndReason] = None
        self.model_requests = 0  # 本次调用已发出的模型请求数（含重试与摘要请求）
        self.budget = ContextBudget(
            context_window=llm.context_window,
            max_tokens=llm.max_tokens,
            safety_ratio=agent_config.context_safety_ratio,
            watermark_ratio=agent_config.compact_watermark,
        )
        self._capacity_error: Optional[str] = None
        self._estimate: Optional[ContextEstimate] = None

        self.plan_tool = PlanTool()
        toolkits = [*tools, self.plan_tool]
        if deliver_file is not None:
            toolkits.append(DeliverTool(deliver_file))
        self.pipeline = ToolPipeline(toolkits)
        self.pipeline.add_after(self._emit_plan_event)
        self.pipeline.add_after(self._emit_delivery_message)
        # 整形放在最后：前面的处理函数读的是工具的原始结果
        self.pipeline.add_after(ResultShaper(agent_config.tool_result_max_chars, write_output))

    @property
    def done(self) -> bool:
        return not self._running

    @property
    def memory(self) -> Optional[Memory]:
        return self._memory

    async def config_snapshot(self) -> Dict[str, Any]:
        """本次运行的配置快照：模型参数、Agent 配置、实际使用的系统提示词全文与工具 schema，供请求重建使用。"""
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
            "agent_config": self._config.model_dump(mode="json"),
            "system_prompt": system_prompt,
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
        self._running = True
        self.end_reason = None
        self.model_requests = 0
        try:
            async for event in self._run(message, drain_injected_messages, prior_status, first_turn_index):
                yield event
        finally:
            self._running = False

    async def _run(
            self,
            message: Message,
            drain: Optional[DrainFn],
            prior_status: Optional[SessionStatus],
            first_turn_index: int,
    ) -> AsyncGenerator[BaseEvent, None]:
        async with self._uow:
            session = await self._uow.session.get_by_id(self._session_id)
            history = await self._uow.event.list(self._session_id, types=["tool", "plan"])
        if not session:
            raise ValueError(f"会话[{self._session_id}]不存在, 请核实后尝试")
        await self._ensure_memory()
        if self.plan_tool.latest_plan is None:
            self.plan_tool.latest_plan = latest_plan(history)

        started = {
            e.tool_call_id for e in history
            if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLING
        }
        status = prior_status if prior_status is not None else session.status
        reply_consumed = await self.repair_dangling_calls(status, message, started)
        for event in self._take_context():
            yield event
        if not session.title or session.title == DEFAULT_SESSION_TITLE:
            yield TitleEvent(title=message.message.strip()[:TITLE_MAX_CHARS])
        if not reply_consumed:
            # 新用户消息开始新的一问：删除此前的思考内容；回复提问属于同一问，不删除
            self._strip_reasoning()
            await self._add_messages([{"role": "user", "content": _user_content(message)}])
        for event in self._take_context():
            yield event
        logger.info(f"会话[{self._session_id}] Agent循环接收消息: {message.message[:50]}...")

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
            await self._request_model(turn)
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
            if content:
                yield MessageEvent(role="assistant", message=content)
            if not calls:
                yield self._turn_completed(turn)
                self.end_reason = RunEndReason.COMPLETED
                yield DoneEvent()
                return

            for call in calls:
                invocation = ToolInvocation(
                    call_id=call["id"],
                    function_name=call["function"]["name"],
                    raw_arguments=call["function"]["arguments"],
                )
                if invocation.function_name == ASK_USER_TOOL and await self.pipeline.check(invocation) is None:
                    # 提问之后的调用留待续接时由 repair_dangling_calls 补结果
                    yield MessageEvent(role="assistant", message=str(invocation.arguments.get("text", "")))
                    yield self._turn_completed(turn)
                    self.end_reason = RunEndReason.WAITING
                    yield WaitEvent()
                    return
                async for event in self.pipeline.run(invocation):
                    if isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED \
                            and event.tool_call_id == invocation.call_id:
                        # 先写记忆再发 called：在 called 之后停止，续接时不会把已执行的调用补成未执行
                        await self._add_messages([
                            tool_message(invocation.call_id, invocation.function_name, invocation.result),
                        ])
                        for context in self._take_context():
                            yield context
                        turn.executed.append(invocation.call_id)
                        turn.tools_ms += invocation.duration_ms or 0
                    yield event
            yield self._turn_completed(turn)

    async def _request_model(self, turn: _ModelTurn) -> None:
        """发出一次模型请求；传输类错误与空回复按 max_retries 重试，每次尝试都计入 max_iterations。"""
        while True:
            if self.model_requests >= self._config.max_iterations:
                turn.failure = RunEndReason.MAX_ITERATIONS
                turn.error = f"模型请求次数达到本次运行上限 {self._config.max_iterations}"
                return
            self.model_requests += 1
            turn.attempts += 1
            started = time.monotonic()
            messages, tools = self._memory.get_messages(), self.pipeline.schemas()
            try:
                result = await self._llm.invoke(messages=messages, tools=tools)
            except Exception as e:
                turn.model_ms += int((time.monotonic() - started) * 1000)
                logger.warning(f"会话[{self._session_id}] 模型请求失败（第 {turn.attempts} 次）: {e}")
                if isinstance(e, LLMRequestError) and e.context_exceeded:
                    turn.overflow = True
                    turn.error = str(e)
                    return
                if not _is_retryable(e) or turn.attempts >= self._config.max_retries:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = str(e) or type(e).__name__
                    return
                await asyncio.sleep(self._retry_interval)
                continue

            turn.model_ms += int((time.monotonic() - started) * 1000)
            turn.add_usage(result.usage)
            self.budget.record_usage(messages, tools, result.usage.prompt_tokens if result.usage else None)
            turn.finish_reason = result.finish_reason
            if result.finish_reason == "length":
                logger.warning(f"会话[{self._session_id}] 模型输出被截断，丢弃本次响应")
                turn.truncated = True
                return
            response = normalize_assistant_message(result.message)
            if not (response.get("content") or "").strip() and not response.get("tool_calls"):
                logger.warning(f"会话[{self._session_id}] 模型返回空回复（第 {turn.attempts} 次）")
                if turn.attempts >= self._config.max_retries:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = f"模型连续 {turn.attempts} 次返回空回复"
                    return
                await asyncio.sleep(self._retry_interval)
                continue
            turn.response = response
            return

    @staticmethod
    def _completion(turn: _ModelTurn, error: Optional[str] = None) -> TurnEvent:
        return TurnEvent(
            phase=TurnPhase.COMPLETED,
            index=turn.index,
            model_ms=turn.model_ms,
            attempts=turn.attempts,
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
            return self._completion(self._open_turn, error)
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
        return ErrorEvent(error=f"{text}（原因：{reason.value}）")

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
        started_call_ids = started_call_ids or set()
        await self._ensure_memory()
        dangling = find_dangling_calls(self._memory.get_messages())
        if not dangling:
            return False

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
        logger.info(f"会话[{self._session_id}] 为 {len(repaired)} 个悬空调用补结果（{status.value}）")
        await self._add_messages(repaired)
        return reply_consumed

    # ---- 执行后处理 ----

    async def _emit_plan_event(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if (invocation.function_name == UPDATE_PLAN_TOOL and not invocation.short_circuited
                and result.success and self.plan_tool.latest_plan is not None):
            invocation.events.append(PlanEvent(
                status=PlanEventStatus.UPDATED,
                plan=self.plan_tool.latest_plan.model_copy(deep=True),
            ))
        return result

    async def _emit_delivery_message(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if invocation.function_name != DELIVER_FILES_TOOL or not isinstance(result.data, DeliveryResult):
            return result
        files = result.data.files
        if files:
            names = "、".join(file.filename or file.filepath for file in files)
            invocation.events.append(MessageEvent(
                role="assistant",
                message=result.data.note or f"已交付文件：{names}",
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
        return self.budget.estimate(self._memory.get_messages(), self.pipeline.schemas())

    async def _ensure_capacity(self, force: bool = False) -> AsyncGenerator[BaseEvent, None]:
        """请求前的容量检查：超过水位（或 force）先压缩并重新估算；仍超过可用上限时置 _capacity_error。

        结束后 _estimate 是本轮请求的估算，随 turn(started) 记录。
        """
        self._capacity_error = None
        estimate = self.estimate_context()
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

    def _raw_total(self, messages: List[Dict[str, Any]]) -> float:
        return sum(raw_parts(messages, self.pipeline.schemas()).values())

    async def _compact_history(self, before: ContextEstimate, trigger: str) -> AsyncGenerator[BaseEvent, None]:
        """把保留区之前的历史替换为摘要，并重新注入其中的用户原文；摘要失败时置 _capacity_error，不改记忆。"""
        messages = self._memory.get_messages()
        system = messages[:1]
        # 保留区（含系统提示词与工具 schema）不超过水位的 60%，给摘要与用户原文留出空间
        plan = plan_compaction(messages, self._config.compact_keep_turns,
                               lambda kept: self._raw_total([*system, *kept]) <= before.watermark * 0.6)
        if plan is None:
            logger.info(f"会话[{self._session_id}] 没有可摘要的完整轮次，跳过压缩")
            return
        summarized, kept = messages[1:plan.boundary], messages[plan.boundary:]

        origins = user_origins(summarized)
        async with self._uow:
            events = await self._uow.event.list(self._session_id, types=["message"])
        match_events(origins, [(e.seq, e.message) for e in events
                               if isinstance(e, MessageEvent) and e.role == "user" and e.seq is not None])
        reinjection = select_reinjection(origins, self._config.compact_user_chars)
        gain = (sum(estimate_message(m) for m in summarized)
                - sum(estimate_message(m) for m in reinjection.messages))
        if trigger == "watermark" and gain < before.limit * MIN_GAIN_RATIO:
            # 可摘要的部分太小（例如最近一轮本身就很大），摘要换不回空间，只会多一次模型请求
            logger.info(f"会话[{self._session_id}] 可摘要部分约 {gain:.0f} tokens，低于最小收益，跳过压缩")
            return

        transcript = render_transcript(
            summarized, lambda text: estimate_text(COMPACT_PROMPT + text) + 16 <= self.budget.limit)
        summary, usage = await self._request_summary(transcript)
        if not summary:
            self._capacity_error = f"上下文压缩的摘要请求连续 {usage.attempts} 次失败或返回空内容，未压缩历史"
            return

        replaced = [summary_message(summary, plan.summarized_turns, reinjection.omitted),
                    *reinjection.messages, *copy.deepcopy(kept)]
        self._memory.replace(replaced)
        self.budget.reset()
        self._pending_context.append(ContextEvent(op=ContextOp.REPLACE, messages=copy.deepcopy(replaced)))
        async with self._uow:
            await self._uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, self._memory)
        after = self.estimate_context()
        logger.info(f"会话[{self._session_id}] 压缩完成：摘要 {plan.summarized_turns} 轮，保留 {plan.kept_turns} 轮，"
                    f"估算 {before.total} → {after.total} tokens")
        yield CompactEvent(
            trigger=trigger,
            before_estimate=before.as_dict(),
            after_estimate=after.as_dict(),
            summarized_turns=plan.summarized_turns,
            kept_turns=plan.kept_turns,
            summary=summary,
            reinjected_event_seqs=reinjection.event_seqs,
            omitted_user_messages=reinjection.omitted,
            usage=usage,
        )
        for event in self._take_context():
            yield event

    async def _request_summary(self, transcript: str) -> tuple[Optional[str], CompactUsage]:
        """独立的摘要请求（不带工具）；传输错误与空回复按 max_retries 重试，每次尝试都计入模型请求数。"""
        usage = CompactUsage()
        request = [{"role": "system", "content": COMPACT_PROMPT}, {"role": "user", "content": transcript}]
        while usage.attempts < self._config.max_retries:
            usage.attempts += 1
            self.model_requests += 1
            try:
                result = await self._llm.invoke(messages=request)
            except Exception as e:
                logger.warning(f"会话[{self._session_id}] 摘要请求失败（第 {usage.attempts} 次）: {e}")
                if not _is_retryable(e):
                    break
                await asyncio.sleep(self._retry_interval)
                continue
            if result.usage is not None:
                usage.prompt_tokens = _add_optional(usage.prompt_tokens, result.usage.prompt_tokens)
                usage.completion_tokens = _add_optional(usage.completion_tokens, result.usage.completion_tokens)
                usage.cached_tokens = _add_optional(usage.cached_tokens, result.usage.cached_tokens)
            summary = str((result.message or {}).get("content") or "").strip()
            if summary:
                return summary, usage
            logger.warning(f"会话[{self._session_id}] 摘要请求返回空内容（第 {usage.attempts} 次）")
            await asyncio.sleep(self._retry_interval)
        return None, usage

    async def _add_messages(self, messages: List[Dict[str, Any]]) -> None:
        await self._ensure_memory()
        if self._memory.empty:
            # system 消息不记为上下文事件：它的全文在运行的 config_snapshot 里
            self._memory.add_message({"role": "system", "content": self._system_prompt})
        self._memory.add_messages(messages)
        self._pending_context.append(ContextEvent(op=ContextOp.APPEND, messages=copy.deepcopy(messages)))
        async with self._uow:
            await self._uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, self._memory)
