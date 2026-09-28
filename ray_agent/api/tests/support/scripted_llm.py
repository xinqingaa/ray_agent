"""脚本化模型替身：按预设顺序返回响应，记录每次请求，供循环测试使用。

脚本中的每一项是以下之一：

- ``ScriptedResponse``：助手文本、工具调用、finish_reason 与 usage；
- ``BaseException`` 实例：调用时直接抛出，模拟传输或服务端错误；
- ``Branch``：按本次请求内容在两项之间选择，选中的项可以再是 ``Branch``。

每次 ``invoke`` 消耗一项；脚本耗尽时抛出 ``ScriptExhaustedError``。
"""
import json
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

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
class ScriptedResponse:
    content: Optional[str] = None
    tool_calls: List[ScriptedToolCall] = field(default_factory=list)
    finish_reason: Optional[str] = None
    usage: Optional[LLMUsage] = None


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


ScriptItem = Union[ScriptedResponse, BaseException, Branch]


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
        return self._build_result(item)

    def _resolve(self, item: ScriptItem, request: ScriptedRequest) -> Union[ScriptedResponse, BaseException]:
        while isinstance(item, Branch):
            item = item.then if item.when(request) else item.otherwise
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
