#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import logging
from typing import Any, Dict, List, Optional

from openai import APIConnectionError, APIStatusError, AsyncOpenAI, InternalServerError, RateLimitError

from app.domain.external.llm import LLM, LLMRequestError, DeltaCallback
from app.domain.models.app_config import LLMConfig
from app.domain.models.llm import LLMInvokeResult, LLMUsage
from app.infrastructure.external.llm.usage import parse_completion_usage
from app.infrastructure.logging import log_session_prefix

logger = logging.getLogger(__name__)

_STREAM_END = object()
# 400 正文里出现这些字样，才认为是供应商拒绝 stream_options，而不是别的参数错误。
_STREAM_OPTION_MARKERS = ("stream_options", "include_usage")


class OpenAILLM(LLM):
    """基于 OpenAI SDK / 兼容格式的模型调用。默认流式组装，配置 streaming=false 时一次返回整包。"""

    def __init__(
            self,
            llm_config: LLMConfig,
            *,
            thinking: Optional[str] = None,
            reasoning_effort: Optional[str] = None,
            reasoning_id: Optional[str] = None,
            keep_reasoning: Optional[bool] = None,
            **kwargs,
    ) -> None:
        """构造函数，完成异步 OpenAI 客户端的创建和参数初始化。

        thinking 为 enabled 或 disabled 时写入 extra_body。reasoning_effort 只在开启思考时发送。
        """
        self._client = AsyncOpenAI(
            base_url=str(llm_config.base_url),
            api_key=llm_config.api_key,
            **kwargs,
        )

        self._model_name = llm_config.model_name
        self._temperature = llm_config.temperature
        from app.domain.models.model_catalog import model_list, provider_for
        spec = next((m for m in model_list(provider_for(str(llm_config.base_url)) or "")
                     if m.id == llm_config.model_name), None)
        self._send_temperature = spec is None or (spec.temperature_when == "always" or
            spec.temperature_when == "disabled" and thinking != "enabled")
        self._max_tokens = llm_config.max_tokens
        self._context_window = llm_config.context_window
        self._streaming = llm_config.streaming
        self._timeout = llm_config.request_timeout
        self._thinking = thinking
        self._reasoning_effort = reasoning_effort
        self._reasoning_id = reasoning_id
        self._keep_reasoning = thinking == "enabled" if keep_reasoning is None else keep_reasoning
        # 供应商拒绝 stream_options 后，同进程后续请求不再携带
        self._include_stream_usage = True

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
    def thinking(self) -> Optional[str]:
        return self._thinking

    @property
    def reasoning_id(self) -> Optional[str]:
        return self._reasoning_id

    @property
    def reasoning_effort(self) -> Optional[str]:
        return self._reasoning_effort

    @property
    def keep_reasoning(self) -> bool:
        """开启思考时，新的一问仍保留此前的 reasoning_content。"""
        return self._keep_reasoning

    async def invoke(
            self,
            messages: List[Dict[str, Any]],
            tools: List[Dict[str, Any]] = None,
            response_format: Dict[str, Any] = None,
            tool_choice: str = None,
            *,
            on_delta: Optional[DeltaCallback] = None,
    ) -> LLMInvokeResult:
        """发起一次模型请求。流式路径逐段交出文本，返回值仍是组装后的完整结果。"""
        prefix = log_session_prefix()
        response_type = (response_format or {}).get("type") if response_format else None
        logger.info(
            f"{prefix}LLM请求 model={self._model_name} stream={self._streaming} tools={bool(tools)} "
            f"tool_choice={tool_choice} response_format={response_type}"
        )
        try:
            if self._streaming:
                return await self._invoke_stream(messages, tools, response_format, tool_choice, on_delta, prefix)
            return await self._invoke_complete(messages, tools, response_format, tool_choice, prefix)
        except LLMRequestError:
            raise
        except Exception as e:
            status_code = getattr(e, "status_code", None)
            logger.error(
                f"{prefix}LLM请求失败 status={status_code} "
                f"code={getattr(e, 'code', None)} error={e}"
            )
            raise LLMRequestError(
                f"调用OpenAI客户端向LLM发起请求出错: {str(e)}",
                retryable=_is_transport_error(e),
                status_code=status_code,
                context_exceeded=_is_context_exceeded(e),
            ) from e

    def _request_kwargs(
            self,
            messages: List[Dict[str, Any]],
            tools: Optional[List[Dict[str, Any]]],
            response_format: Optional[Dict[str, Any]],
            tool_choice: Optional[str],
            *,
            stream: bool,
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": self._model_name,
            "max_tokens": self._max_tokens,
            "messages": messages,
            "response_format": response_format,
            "timeout": self._timeout,
        }
        if self._send_temperature:
            kwargs["temperature"] = self._temperature
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
            kwargs["parallel_tool_calls"] = False  # 关闭并行工具调用(deepseek没有这个参数的)
        if stream:
            kwargs["stream"] = True
            if self._include_stream_usage:
                kwargs["stream_options"] = {"include_usage": True}
        if self._thinking in ("enabled", "disabled"):
            kwargs["extra_body"] = {"thinking": {"type": self._thinking}}
        if self._reasoning_effort:
            kwargs["reasoning_effort"] = self._reasoning_effort
        return kwargs

    async def _create(self, kwargs: Dict[str, Any]) -> Any:
        """供应商拒绝 stream_options 时去掉该参数重试一次，并记住之后不再携带。"""
        try:
            return await self._client.chat.completions.create(**kwargs)
        except Exception as e:
            if "stream_options" not in kwargs or not _rejects_stream_options(e):
                raise
            self._include_stream_usage = False
            logger.warning("供应商拒绝 stream_options，后续请求不再携带 include_usage")
            trimmed = {key: value for key, value in kwargs.items() if key != "stream_options"}
            return await self._client.chat.completions.create(**trimmed)

    async def _invoke_complete(
            self,
            messages: List[Dict[str, Any]],
            tools: Optional[List[Dict[str, Any]]],
            response_format: Optional[Dict[str, Any]],
            tool_choice: Optional[str],
            prefix: str,
    ) -> LLMInvokeResult:
        response = await self._create(self._request_kwargs(
            messages, tools, response_format, tool_choice, stream=False,
        ))
        choice = response.choices[0]
        message = choice.message
        usage = parse_completion_usage(getattr(response, "usage", None))
        logger.info(
            f"{prefix}LLM响应 model={self._model_name} finish_reason={choice.finish_reason} "
            f"has_content={bool(message.content)} tool_calls={len(message.tool_calls or [])} "
            f"usage={usage.model_dump() if usage else None}"
        )
        logger.debug(f"{prefix}LLM完整响应: {response.model_dump()}")
        return LLMInvokeResult(message=message.model_dump(), usage=usage, finish_reason=choice.finish_reason)

    async def _invoke_stream(
            self,
            messages: List[Dict[str, Any]],
            tools: Optional[List[Dict[str, Any]]],
            response_format: Optional[Dict[str, Any]],
            tool_choice: Optional[str],
            on_delta: Optional[DeltaCallback],
            prefix: str,
    ) -> LLMInvokeResult:
        started = asyncio.get_running_loop().time()
        stream = await self._create(self._request_kwargs(
            messages, tools, response_format, tool_choice, stream=True,
        ))
        assembly = _StreamAssembly()
        ttft_ms: Optional[int] = None
        try:
            async for chunk in self._iter_chunks(stream):
                text, visible = assembly.add(chunk)
                if visible and ttft_ms is None:
                    ttft_ms = max(0, int((asyncio.get_running_loop().time() - started) * 1000))
                if text and on_delta is not None:
                    await on_delta(text)
        finally:
            close = getattr(stream, "aclose", None)
            if close is not None:
                try:
                    await close()
                except Exception as e:
                    logger.debug(f"{prefix}关闭模型流: {e!r}")
        if not assembly.finish_reason:
            raise LLMRequestError(
                "模型流在结束原因前结束",
                retryable=True,
                reason="stream_interrupted",
            )
        message = assembly.message()
        logger.info(
            f"{prefix}LLM响应 model={self._model_name} stream=True finish_reason={assembly.finish_reason} "
            f"has_content={bool(message.get('content'))} tool_calls={len(message.get('tool_calls') or [])} "
            f"ttft_ms={ttft_ms} usage={assembly.usage.model_dump() if assembly.usage else None}"
        )
        return LLMInvokeResult(
            message=message,
            usage=assembly.usage,
            finish_reason=assembly.finish_reason,
            ttft_ms=ttft_ms,
        )

    async def _iter_chunks(self, stream: Any):
        """分片间隔（含等待首个分片）超过 request_timeout 视为传输错误。"""
        iterator = stream.__aiter__()
        while True:
            try:
                chunk = await asyncio.wait_for(_next_or_end(iterator), self._timeout)
            except asyncio.TimeoutError as e:
                raise LLMRequestError(
                    f"等待模型输出超过 {self._timeout:g} 秒",
                    retryable=True,
                    reason="transport",
                ) from e
            if chunk is _STREAM_END:
                return
            yield chunk


class _StreamAssembly:
    """把 choices[0].delta 收成一条与非流式 message.model_dump() 同形的消息。"""

    def __init__(self) -> None:
        self._content: List[str] = []
        self._reasoning: List[str] = []
        self._tools: Dict[int, Dict[str, Optional[str]]] = {}
        self.finish_reason: Optional[str] = None
        self.usage: Optional[LLMUsage] = None

    def add(self, chunk: Any) -> tuple[Optional[str], bool]:
        """返回 (文本增量, 这一片是否是可见文本或工具调用片段)。推理分片两者都不是。"""
        parsed = parse_completion_usage(_field(chunk, "usage"))
        if parsed is not None:
            self.usage = parsed
        choices = _field(chunk, "choices") or []
        if not choices:
            return None, False
        choice = choices[0]
        finish = _field(choice, "finish_reason")
        if finish:
            self.finish_reason = str(finish)
        delta = _field(choice, "delta")
        if delta is None:
            return None, False
        text: Optional[str] = None
        visible = False
        content = _field(delta, "content")
        if isinstance(content, str) and content:
            self._content.append(content)
            text = content
            visible = True
        reasoning = _field(delta, "reasoning_content")
        if isinstance(reasoning, str) and reasoning:
            self._reasoning.append(reasoning)
        tool_calls = _field(delta, "tool_calls") or []
        if tool_calls:
            visible = True
            for raw in tool_calls:
                index = _field(raw, "index")
                slot = self._tools.setdefault(0 if index is None else int(index), {
                    "id": None, "name": "", "arguments": "",
                })
                call_id = _field(raw, "id")
                if call_id and not slot["id"]:
                    slot["id"] = str(call_id)
                function = _field(raw, "function")
                name = _field(function, "name")
                if name:
                    slot["name"] = f"{slot['name']}{name}"
                arguments = _field(function, "arguments")
                if arguments:
                    slot["arguments"] = f"{slot['arguments']}{arguments}"
        return text, visible

    def message(self) -> Dict[str, Any]:
        message: Dict[str, Any] = {
            "role": "assistant",
            "content": "".join(self._content) or None,
        }
        if self._reasoning:
            message["reasoning_content"] = "".join(self._reasoning)
        if self._tools:
            message["tool_calls"] = [
                {
                    "id": slot["id"] or "",
                    "type": "function",
                    "function": {"name": slot["name"], "arguments": slot["arguments"]},
                }
                for index, slot in sorted(self._tools.items())
            ]
        return message


def _field(source: Any, name: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


async def _next_or_end(iterator: Any) -> Any:
    """StopAsyncIteration 不能直接穿出 wait_for，否则会变成 RuntimeError。"""
    try:
        return await iterator.__anext__()
    except StopAsyncIteration:
        return _STREAM_END


_CONTEXT_EXCEEDED_MARKERS = ("context_length_exceeded", "maximum context length", "context length",
                             "context window", "too many tokens", "prompt is too long")


def _is_context_exceeded(error: Exception) -> bool:
    """OpenAI 兼容服务的上下文超长拒绝：400 且错误码或信息提到上下文长度（DeepSeek 为 maximum context length）。"""
    if not isinstance(error, APIStatusError) or error.status_code not in (400, 413):
        return False
    text = f"{getattr(error, 'code', '') or ''} {error}".lower()
    return any(marker in text for marker in _CONTEXT_EXCEEDED_MARKERS)


def _rejects_stream_options(error: Exception) -> bool:
    """只认正文里点名 stream_options / include_usage 的 400，避免把别的参数错误当成这个开关。"""
    if _is_context_exceeded(error):
        return False
    if not isinstance(error, APIStatusError) or error.status_code != 400:
        return False
    text = f"{getattr(error, 'code', '') or ''} {error}".lower()
    return any(marker in text for marker in _STREAM_OPTION_MARKERS)


def _is_transport_error(error: Exception) -> bool:
    """连接、超时、限流与 5xx 可以重发；参数、鉴权、额度等错误重发也不会成功。"""
    if isinstance(error, (APIConnectionError, RateLimitError, InternalServerError)):
        return True
    if isinstance(error, APIStatusError):
        return error.status_code == 429 or error.status_code >= 500
    return False


if __name__ == "__main__":
    async def main():
        llm = OpenAILLM(LLMConfig(
            base_url="https://api.deepseek.com",
            api_key="",
            model_name="deepseek-chat",
        ))
        response = await llm.invoke([{"role": "user", "content": "Hi"}])
        print(response)


    asyncio.run(main())
