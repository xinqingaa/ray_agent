#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""工具三段管线：执行前 → 执行 → 执行后。

每段是按注册顺序执行的处理函数列表，由 Agent 循环持有：

- 执行前 ``BeforeHandler(invocation) -> ToolResult | None``：返回结果即短路，
  其余执行前处理与执行段都不再运行；设置 ``invocation.suspend_event`` 则挂起（见下）；
- 执行 ``Executor(invocation) -> ToolResult``：只调用一次，异常转为失败结果，不重试；
- 执行后 ``AfterHandler(invocation, result) -> ToolResult``：可以替换结果，短路时照常运行。

除挂起外，任何路径都产出一个与 call ID 配对的结果，并发出 called 工具事件；
处理函数追加到 ``invocation.events`` 的事件在 called 事件之后按顺序发出。
挂起（如等待审批）时管线只发出 ``suspend_event``，不执行、不运行执行后处理、不产生结果，由循环结束本次调用。
"""
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional

from app.domain.models.event import BaseEvent, ToolEvent, ToolEventStatus, ToolResultShaping
from app.domain.models.tool_result import ToolResult
from app.domain.services.tools.base import BaseTool

logger = logging.getLogger(__name__)

UNKNOWN_TOOLKIT = "unknown"


@dataclass
class ToolInvocation:
    """一次工具调用在管线中的状态。call_id、function_name、raw_arguments 来自模型消息，不可改写。"""
    call_id: str
    function_name: str
    raw_arguments: str
    arguments: Dict[str, Any] = field(default_factory=dict)
    tool: Optional[BaseTool] = None
    started_at: float = 0.0
    duration_ms: Optional[int] = None
    short_circuited: bool = False
    result: Optional[ToolResult] = None
    raw_result: Optional[ToolResult] = None  # 执行后处理之前的结果
    shaping: Optional[ToolResultShaping] = None  # 结果整形处理函数写入
    events: List[BaseEvent] = field(default_factory=list)
    approval: Optional[str] = None  # 用户对本次调用的审批结果（ApprovalStatus 取值），续接审批时由循环写入
    suspend_event: Optional[BaseEvent] = None  # 执行前处理写入即挂起
    denied_by: Optional[str] = None  # 短路原因：policy（策略禁止）/ user（用户拒绝）/ plan_mode（计划模式不允许）

    @property
    def suspended(self) -> bool:
        return self.suspend_event is not None

    @property
    def toolkit_name(self) -> str:
        return self.tool.name if self.tool else UNKNOWN_TOOLKIT

    def tool_event(self, status: ToolEventStatus, result: Optional[ToolResult] = None) -> ToolEvent:
        called = status == ToolEventStatus.CALLED
        event = ToolEvent(
            tool_call_id=self.call_id,
            tool_name=self.toolkit_name,
            function_name=self.function_name,
            function_args=self.arguments,
            function_result=result,
            status=status,
            duration_ms=self.duration_ms if called else None,
            shaping=self.shaping if called else None,
            denied_by=self.denied_by if called else None,
        )
        if called and self.shaping is not None:
            event._raw_result = self.raw_result
        return event


BeforeHandler = Callable[[ToolInvocation], Awaitable[Optional[ToolResult]]]
Executor = Callable[[ToolInvocation], Awaitable[ToolResult]]
AfterHandler = Callable[[ToolInvocation, ToolResult], Awaitable[ToolResult]]


def parse_arguments(raw: Optional[str]) -> Dict[str, Any]:
    """严格解析参数 JSON；空字符串视为无参数。失败抛 ValueError，由管线转为失败结果。"""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as e:
        raise ValueError(f"参数不是合法 JSON：{e}") from e
    if not isinstance(parsed, dict):
        raise ValueError(f"参数必须是 JSON 对象，实际为 {type(parsed).__name__}")
    return parsed


_JSON_TYPES = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "null": lambda v: v is None,
}


def validate_arguments(schema: Optional[Dict[str, Any]], arguments: Dict[str, Any]) -> Optional[str]:
    """按工具声明做轻量校验：必填字段、顶层字段的基本类型与枚举。返回错误说明，通过时为 None。

    只覆盖顶层；anyOf 等组合声明与嵌套结构交给工具自身校验，避免误拒外部 MCP 工具可接受的参数。
    """
    if not schema:
        return None
    missing = [name for name in schema.get("required") or [] if name not in arguments]
    if missing:
        return f"缺少必填参数：{', '.join(missing)}"
    properties = schema.get("properties") or {}
    for name, value in arguments.items():
        spec = properties.get(name)
        if not isinstance(spec, dict):
            continue
        expected = spec.get("type")
        types = expected if isinstance(expected, list) else [expected] if isinstance(expected, str) else []
        checkers = [_JSON_TYPES[t] for t in types if t in _JSON_TYPES]
        if checkers and not any(check(value) for check in checkers):
            return f"参数 {name} 类型应为 {'/'.join(types)}，实际为 {type(value).__name__}"
        if "enum" in spec and value not in spec["enum"]:
            return f"参数 {name} 取值应为 {spec['enum']} 之一，实际为 {value!r}"
    return None


class ToolPipeline:
    """持有工具集与三段处理函数。内置处理函数在构造时注册，后续包用 add_before / add_after 追加。"""

    def __init__(self, tools: List[BaseTool], executor: Optional[Executor] = None) -> None:
        self._tools = list(tools)
        self._before: List[BeforeHandler] = []
        self._after: List[AfterHandler] = []
        self._executor: Executor = executor or self._execute_once
        self._before.extend([self._record_start, self._resolve_tool, self._parse_arguments, self._validate_arguments])
        self._after.append(self._record_duration)

    # ---- 注册接口 ----

    def add_before(self, handler: BeforeHandler) -> None:
        self._before.append(handler)

    def add_after(self, handler: AfterHandler) -> None:
        self._after.append(handler)

    # ---- 工具查询 ----

    @property
    def tools(self) -> List[BaseTool]:
        return list(self._tools)

    def schemas(self) -> List[Dict[str, Any]]:
        schemas: List[Dict[str, Any]] = []
        for toolkit in self._tools:
            schemas.extend(toolkit.get_tools())
        return schemas

    def find_toolkit(self, function_name: str) -> Optional[BaseTool]:
        return next((toolkit for toolkit in self._tools if function_name and toolkit.has_tool(function_name)), None)

    def parameters_schema(self, function_name: str) -> Optional[Dict[str, Any]]:
        for schema in self.schemas():
            function = schema.get("function") or {}
            if function.get("name") == function_name:
                return function.get("parameters")
        return None

    async def check(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        """只运行内置的存在性、解析与校验，不计入事件；供循环在拦截调用（如提问）前判断参数是否可用。"""
        for handler in (self._resolve_tool, self._parse_arguments, self._validate_arguments):
            result = await handler(invocation)
            if result is not None:
                return result
        return None

    # ---- 运行 ----

    async def run(self, invocation: ToolInvocation) -> AsyncGenerator[BaseEvent, None]:
        """产出本次调用的事件；结束后 ``invocation`` 上的 result 即为写入记忆的结果（挂起时为空）。"""
        result: Optional[ToolResult] = None
        for handler in self._before:
            result = await handler(invocation)
            if result is not None:
                invocation.short_circuited = True
                break
            if invocation.suspend_event is not None:
                yield invocation.suspend_event
                return

        if result is None:
            yield invocation.tool_event(ToolEventStatus.CALLING)
            result = await self._executor(invocation)

        invocation.raw_result = result
        for handler in self._after:
            result = await handler(invocation, result)

        invocation.result = result
        yield invocation.tool_event(ToolEventStatus.CALLED, result)
        for event in invocation.events:
            yield event

    # ---- 内置处理函数 ----

    @staticmethod
    async def _record_start(invocation: ToolInvocation) -> Optional[ToolResult]:
        invocation.started_at = time.monotonic()
        return None

    async def _resolve_tool(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        invocation.tool = self.find_toolkit(invocation.function_name)
        if invocation.tool is None:
            return ToolResult(success=False, message=f"未知工具：{invocation.function_name or '(空)'}，请只调用已提供的工具")
        return None

    @staticmethod
    async def _parse_arguments(invocation: ToolInvocation) -> Optional[ToolResult]:
        try:
            invocation.arguments = parse_arguments(invocation.raw_arguments)
        except ValueError as e:
            invocation.arguments = {}
            return ToolResult(success=False, message=f"{e}。请修正参数后重新调用")
        return None

    async def _validate_arguments(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        error = validate_arguments(self.parameters_schema(invocation.function_name), invocation.arguments)
        if error:
            return ToolResult(success=False, message=f"{error}。请修正参数后重新调用")
        return None

    @staticmethod
    async def _execute_once(invocation: ToolInvocation) -> ToolResult:
        try:
            result = await invocation.tool.invoke(invocation.function_name, **invocation.arguments)
        except Exception as e:
            logger.exception(f"工具[{invocation.function_name}]执行异常: {e}")
            return ToolResult(success=False, message=f"工具执行异常：{type(e).__name__}: {e}")
        if not isinstance(result, ToolResult):
            return ToolResult(success=False, message=f"工具返回了无法识别的结果：{result!r}")
        return result

    @staticmethod
    async def _record_duration(invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        invocation.duration_ms = int((time.monotonic() - invocation.started_at) * 1000)
        return result
