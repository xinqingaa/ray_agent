#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""单循环 Agent：一份记忆里交替进行模型请求与工具批次，没有工具调用的回复就是最终答复。

一次运行（``invoke``）的事件序列由以下类型组成：Title、Message、Tool、Plan、Wait、Error、Done、Usage。
运行只以三种终止事件之一结束：DoneEvent（完成）、WaitEvent（等待用户回复）、ErrorEvent（失败）。
"""
import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Set

from app.domain.external.browser import Browser
from app.domain.external.llm import LLM, LLMRequestError
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.models.app_config import AgentConfig
from app.domain.models.event import (
    BaseEvent,
    DoneEvent,
    ErrorEvent,
    MessageEvent,
    PlanEvent,
    PlanEventStatus,
    TitleEvent,
    ToolEvent,
    ToolEventStatus,
    UsageEvent,
    WaitEvent,
)
from app.domain.models.llm import LLMUsage
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.session import DEFAULT_SESSION_TITLE, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.agents.tool_call_compat import extract_embedded_tool_calls
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


@dataclass
class _ModelTurn:
    """一次模型请求（含重试）的结果：response 与 failure 至多一个有值，truncated 表示应丢弃并重试。"""
    response: Optional[Dict[str, Any]] = None
    truncated: bool = False
    failure: Optional[RunEndReason] = None
    error: str = ""


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
            system_prompt: str = SYSTEM_PROMPT,
            retry_interval: float = 1.0,
    ) -> None:
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._llm = llm
        self._config = agent_config
        self._session_id = session_id
        self._system_prompt = system_prompt
        self._retry_interval = retry_interval
        self._memory: Optional[Memory] = None
        self._running = False
        self.end_reason: Optional[RunEndReason] = None
        self.model_requests = 0  # 本次运行已发出的模型请求数（含重试）

        self.plan_tool = PlanTool()
        toolkits = [*tools, self.plan_tool]
        if deliver_file is not None:
            toolkits.append(DeliverTool(deliver_file))
        self.pipeline = ToolPipeline(toolkits)
        self.pipeline.add_after(self._emit_plan_event)
        self.pipeline.add_after(self._emit_delivery_message)

    @property
    def done(self) -> bool:
        return not self._running

    @property
    def memory(self) -> Optional[Memory]:
        return self._memory

    # ---- 运行 ----

    async def invoke(
            self,
            message: Message,
            drain_injected_messages: Optional[DrainFn] = None,
    ) -> AsyncGenerator[BaseEvent, None]:
        self._running = True
        self.end_reason = None
        self.model_requests = 0
        try:
            async for event in self._run(message, drain_injected_messages):
                yield event
        finally:
            self._running = False

    async def _run(self, message: Message, drain: Optional[DrainFn]) -> AsyncGenerator[BaseEvent, None]:
        async with self._uow:
            session = await self._uow.session.get_by_id(self._session_id)
        if not session:
            raise ValueError(f"会话[{self._session_id}]不存在, 请核实后尝试")
        await self._ensure_memory()
        if self.plan_tool.latest_plan is None:
            self.plan_tool.latest_plan = session.get_latest_plan()

        started = {
            e.tool_call_id for e in session.events
            if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLING
        }
        reply_consumed = await self.repair_dangling_calls(session.status, message, started)
        async with self._uow:
            await self._uow.session.update_status(self._session_id, SessionStatus.RUNNING)
        if not session.title or session.title == DEFAULT_SESSION_TITLE:
            yield TitleEvent(title=message.message.strip()[:TITLE_MAX_CHARS])
        if not reply_consumed:
            # 新用户消息是旧实现的步骤边界：裁掉此前的浏览器页面结果与思考内容；回复提问属于同一轮，不裁剪
            self._memory.compact()
            await self._add_messages([{"role": "user", "content": _user_content(message)}])
        logger.info(f"会话[{self._session_id}] Agent循环接收消息: {message.message[:50]}...")

        truncations = 0
        while True:
            if drain is not None:
                injected = await drain()
                if injected:
                    logger.info(f"会话[{self._session_id}] 追加运行中补充的消息 {len(injected)} 条")
                    await self._add_messages([{"role": "user", "content": _user_content(m)} for m in injected])

            turn = _ModelTurn()
            async for event in self._request_model(turn):
                yield event
            if turn.failure is not None:
                yield self._fail(turn.failure, turn.error)
                return
            if turn.truncated:
                truncations += 1
                if truncations > 1:
                    yield self._fail(RunEndReason.OUTPUT_TRUNCATED, "模型输出连续两次超过长度上限被截断")
                    return
                await self._add_messages([{"role": "user", "content": TRUNCATION_PROMPT}])
                continue
            truncations = 0

            assistant = turn.response
            await self._add_messages([assistant])
            content = (assistant.get("content") or "").strip()
            calls = assistant.get("tool_calls") or []
            if content:
                yield MessageEvent(role="assistant", message=content)
            if not calls:
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
                    yield event

    async def _request_model(self, turn: _ModelTurn) -> AsyncGenerator[BaseEvent, None]:
        """发出一次模型请求；传输类错误与空回复按 max_retries 重试，每次尝试都计入 max_iterations。"""
        attempts = 0
        while True:
            if self.model_requests >= self._config.max_iterations:
                turn.failure = RunEndReason.MAX_ITERATIONS
                turn.error = f"模型请求次数达到本次运行上限 {self._config.max_iterations}"
                return
            self.model_requests += 1
            attempts += 1
            try:
                result = await self._llm.invoke(
                    messages=self._memory.get_messages(),
                    tools=self.pipeline.schemas(),
                )
            except Exception as e:
                logger.warning(f"会话[{self._session_id}] 模型请求失败（第 {attempts} 次）: {e}")
                if not _is_retryable(e) or attempts >= self._config.max_retries:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = str(e) or type(e).__name__
                    return
                await asyncio.sleep(self._retry_interval)
                continue

            yield self._usage_event(result.usage)
            if result.finish_reason == "length":
                logger.warning(f"会话[{self._session_id}] 模型输出被截断，丢弃本次响应")
                turn.truncated = True
                return
            response = normalize_assistant_message(result.message)
            if not (response.get("content") or "").strip() and not response.get("tool_calls"):
                logger.warning(f"会话[{self._session_id}] 模型返回空回复（第 {attempts} 次）")
                if attempts >= self._config.max_retries:
                    turn.failure = RunEndReason.MODEL_ERROR
                    turn.error = f"模型连续 {attempts} 次返回空回复"
                    return
                await asyncio.sleep(self._retry_interval)
                continue
            turn.response = response
            return

    def _fail(self, reason: RunEndReason, detail: str) -> ErrorEvent:
        self.end_reason = reason
        logger.warning(f"会话[{self._session_id}] Agent循环失败结束 reason={reason.value}: {detail}")
        if reason == RunEndReason.MODEL_ERROR:
            text = format_public_error_text(detail)
        else:
            text = f"{detail}，任务未完成。可在本任务中重试。"
        return ErrorEvent(error=f"{text}（原因：{reason.value}）")

    def _usage_event(self, usage: Optional[LLMUsage]) -> UsageEvent:
        available = bool(usage and usage.available)
        return UsageEvent(
            agent=AGENT_MEMORY_NAME,
            available=available,
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
            total_tokens=usage.total_tokens if usage else None,
            context_window=self._llm.context_window,
        )

    # ---- 悬空调用 ----

    async def repair_dangling_calls(
            self,
            status: SessionStatus,
            message: Optional[Message] = None,
            started_call_ids: Optional[Set[str]] = None,
    ) -> bool:
        """为上一次运行留下的无结果调用补结果，保证之后的模型请求不含悬空调用。

        会话处于 waiting 时，第一个悬空的提问调用以用户回复为结果，其余调用补为“等待用户回复后重新决策”；
        failed 补为“任务失败”；其他状态（停止写为 completed、进程中断仍为 running）补为“任务已停止”。
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

    async def _add_messages(self, messages: List[Dict[str, Any]]) -> None:
        await self._ensure_memory()
        if self._memory.empty:
            self._memory.add_message({"role": "system", "content": self._system_prompt})
        self._memory.add_messages(messages)
        async with self._uow:
            await self._uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, self._memory)
