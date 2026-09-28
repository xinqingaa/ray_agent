"""脚本化模型替身：按预设顺序返回响应，记录每次请求，供循环测试使用。

脚本中的每一项是以下之一：

- ``ScriptedResponse``：助手文本、工具调用、finish_reason 与 usage；
  带 ``chunks`` 时按片段回调文本增量并计算首字延迟，最终消息仍取 content / tool_calls；
- ``BaseException`` 实例：调用时直接抛出，模拟传输或服务端错误；
- ``Branch``：按本次请求内容在两项之间选择，选中的项可以再是 ``Branch``；
- ``Dynamic``：按本次请求内容现场生成一项。

每次 ``invoke`` 消耗一项；脚本耗尽时抛出 ``ScriptExhaustedError``。
"""
import asyncio
import json
import time
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from app.domain.external.llm import LLMRequestError
from app.domain.models.llm import LLMInvokeResult, LLMUsage


class ScriptExhaustedError(RuntimeError):
    """脚本已用完仍收到调用。产品代码可能捕获并吞掉它，测试应同时断言 ``exhausted_calls == 0``。"""


class ScriptedInvokeResult(LLMInvokeResult):
    """脚本产生的调用结果；finish_reason 自 W1 起是产品字段，定义在父类上。"""


@dataclass
class ScriptedToolCall:
    name: str
    arguments: Union[str, Dict[str, Any]] = field(default_factory=dict)
    id: Optional[str] = None

    def arguments_text(self) -> str:
        """字典按 JSON 编码；字符串原样返回，便于构造非法参数。"""
        if isinstance(self.arguments, str):
            return self.arguments
        return json.dumps(self.arguments, ensure_ascii=False)


@dataclass
class ScriptedChunk:
    """流式分片。text 会交给 on_delta；reasoning 只占一个分片，不产生文本增量。

    tool_* 任一非空表示出现了工具调用片段，计入首字延迟，但不预览参数。
    """
    text: Optional[str] = None
    reasoning: Optional[str] = None
    tool_index: Optional[int] = None
    tool_id: Optional[str] = None
    tool_name: Optional[str] = None
    tool_arguments: Optional[str] = None


@dataclass
class ScriptedResponse:
    content: Optional[str] = None
    tool_calls: List[ScriptedToolCall] = field(default_factory=list)
    finish_reason: Optional[str] = None
    usage: Optional[LLMUsage] = None
    chunks: Optional[List[ScriptedChunk]] = None
    first_chunk_delay: float = 0.0  # 首个分片前的等待
    chunk_interval: float = 0.0  # 后续分片之间的等待
    interrupted: bool = False  # 分片放完后以流中断失败，不返回结果
    hold: Optional[asyncio.Event] = None  # 分片放完后一直等待，直到调用方取消


@dataclass
class ScriptedRequest:
    """一次 invoke 收到的参数副本。"""
    messages: List[Dict[str, Any]]
    tools: Optional[List[Dict[str, Any]]]
    response_format: Optional[Dict[str, Any]]
    tool_choice: Optional[str]

    @property
    def last_message(self) -> Optional[Dict[str, Any]]:
        return self.messages[-1] if self.messages else None

    @property
    def last_tool_content(self) -> Optional[str]:
        """最后一条消息为 tool 时返回其内容，否则为 None。"""
        message = self.last_message
        if not message or message.get("role") != "tool":
            return None
        content = message.get("content")
        return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)

    @property
    def tool_names(self) -> List[str]:
        return [tool.get("function", {}).get("name", "") for tool in (self.tools or [])]


@dataclass
class Branch:
    when: Callable[[ScriptedRequest], bool]
    then: "ScriptItem"
    otherwise: "ScriptItem"


@dataclass
class Dynamic:
    """按本次请求内容生成脚本项，用于参数取决于先前工具结果的调用（例如按预览给出的行数分段读取）。"""
    build: Callable[[ScriptedRequest], "ScriptItem"]


ScriptItem = Union[ScriptedResponse, BaseException, Branch, Dynamic]


def text(content: str, *, finish_reason: Optional[str] = None,
         usage: Optional[LLMUsage] = None) -> ScriptedResponse:
    return ScriptedResponse(content=content, finish_reason=finish_reason, usage=usage)


def tool_call(name: str, arguments: Union[str, Dict[str, Any], None] = None, *,
              id: Optional[str] = None, content: Optional[str] = None,
              finish_reason: Optional[str] = None,
              usage: Optional[LLMUsage] = None) -> ScriptedResponse:
    """单个工具调用的响应；多个调用直接构造 ScriptedResponse。"""
    call = ScriptedToolCall(name=name, arguments=arguments if arguments is not None else {}, id=id)
    return ScriptedResponse(content=content, tool_calls=[call], finish_reason=finish_reason, usage=usage)


def usage(prompt_tokens: int, completion_tokens: int) -> LLMUsage:
    return LLMUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
    )


def when_last_tool_contains(substring: str, then: ScriptItem, otherwise: ScriptItem) -> Branch:
    return Branch(
        when=lambda request: substring in (request.last_tool_content or ""),
        then=then,
        otherwise=otherwise,
    )


class ScriptedLLM:
    """满足 ``app.domain.external.llm.LLM`` 协议的确定性替身。"""

    def __init__(
            self,
            script: List[ScriptItem],
            *,
            model_name: str = "scripted",
            temperature: float = 0.0,
            max_tokens: int = 4096,
            context_window: int = 32000,
    ) -> None:
        self._script = list(script)
        self._model_name = model_name
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._context_window = context_window
        self._next_call_id = 1
        self.requests: List[ScriptedRequest] = []
        self.exhausted_calls = 0

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def temperature(self) -> float:
        return self._temperature

    @property
    def max_tokens(self) -> int:
        return self._max_tokens

    @property
    def context_window(self) -> int:
        return self._context_window

    @property
    def remaining(self) -> int:
        return len(self._script)

    @property
    def call_count(self) -> int:
        return len(self.requests)

    async def invoke(
            self,
            messages: List[Dict[str, Any]],
            tools: List[Dict[str, Any]] = None,
            response_format: Dict[str, Any] = None,
            tool_choice: str = None,
            *,
            on_delta: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> LLMInvokeResult:
        request = ScriptedRequest(
            messages=deepcopy(messages),
            tools=deepcopy(tools),
            response_format=deepcopy(response_format),
            tool_choice=tool_choice,
        )
        self.requests.append(request)
        if not self._script:
            self.exhausted_calls += 1
            raise ScriptExhaustedError(
                f"ScriptedLLM 脚本已耗尽：第 {len(self.requests)} 次调用没有对应的脚本项"
            )
        item = self._resolve(self._script.pop(0), request)
        if isinstance(item, BaseException):
            raise item
        return await self._finish_response(item, on_delta)

    async def _finish_response(
            self,
            response: ScriptedResponse,
            on_delta: Optional[Callable[[str], Awaitable[None]]],
    ) -> ScriptedInvokeResult:
        ttft_ms = None
        if response.chunks or response.interrupted or response.hold is not None:
            ttft_ms = await self._play_chunks(response, on_delta)
            if response.hold is not None:
                await response.hold.wait()
            if response.interrupted:
                raise LLMRequestError(
                    "模型流在结束原因前结束",
                    retryable=True,
                    reason="stream_interrupted",
                )
        result = self._build_result(response)
        result.ttft_ms = ttft_ms
        return result

    async def _play_chunks(
            self,
            response: ScriptedResponse,
            on_delta: Optional[Callable[[str], Awaitable[None]]],
    ) -> Optional[int]:
        chunks = response.chunks or []
        if not chunks:
            return None
        started = time.monotonic()
        await asyncio.sleep(response.first_chunk_delay)
        ttft_ms: Optional[int] = None
        for index, chunk in enumerate(chunks):
            if index > 0 and response.chunk_interval:
                await asyncio.sleep(response.chunk_interval)
            visible = False
            if chunk.text:
                visible = True
                if on_delta is not None:
                    await on_delta(chunk.text)
            if (chunk.tool_index is not None or chunk.tool_id or chunk.tool_name
                    or chunk.tool_arguments is not None):
                visible = True
            if visible and ttft_ms is None:
                ttft_ms = max(0, int((time.monotonic() - started) * 1000))
        return ttft_ms

    def _resolve(self, item: ScriptItem, request: ScriptedRequest) -> Union[ScriptedResponse, BaseException]:
        while isinstance(item, (Branch, Dynamic)):
            item = item.build(request) if isinstance(item, Dynamic) else \
                item.then if item.when(request) else item.otherwise
        if not isinstance(item, (ScriptedResponse, BaseException)):
            raise TypeError(f"不支持的脚本项类型: {type(item).__name__}")
        return item

    def _build_result(self, response: ScriptedResponse) -> ScriptedInvokeResult:
        tool_calls = None
        if response.tool_calls:
            tool_calls = []
            for call in response.tool_calls:
                call_id = call.id or f"call_scripted_{self._next_call_id}"
                self._next_call_id += 1
                tool_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.arguments_text()},
                })
        finish_reason = response.finish_reason or ("tool_calls" if tool_calls else "stop")
        return ScriptedInvokeResult(
            message={"role": "assistant", "content": response.content, "tool_calls": tool_calls},
            usage=response.usage.model_copy() if response.usage else None,
            finish_reason=finish_reason,
        )
