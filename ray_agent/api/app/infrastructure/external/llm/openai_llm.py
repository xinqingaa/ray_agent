#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import copy
import base64
import json
import logging
import re
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional

import httpx
from openai import (APIConnectionError, APIError, APIStatusError, AsyncOpenAI, DefaultAsyncHttpxClient,
                    InternalServerError, RateLimitError)

from app.domain.external.llm import LLM, LLMRequestError, DeltaCallback, ModelProgress, ProgressCallback
from app.domain.models.app_config import LLMConfig
from app.domain.models.llm import LLMInvokeResult, LLMUsage
from app.domain.models.clock import utc_now
from app.domain.services.usage_pricing import token_charge
from app.infrastructure.external.llm.usage_recording import record_usage
from app.infrastructure.external.llm.upstream_errors import redact_credentials, upstream_message
from app.infrastructure.external.llm.usage import parse_completion_usage
from app.infrastructure.logging import log_session_prefix
from app.infrastructure.external.llm.responses import plain, response_input, response_tools, response_result, response_error

logger = logging.getLogger(__name__)

_STREAM_END = object()
# 400 正文里出现这些字样，才认为是供应商拒绝 stream_options，而不是别的参数错误。
_STREAM_OPTION_MARKERS = ("stream_options", "include_usage")
_SUMMARY_MARKERS = ("reasoning.summary", "summary")
_SUMMARY_UNSUPPORTED: set[tuple[str, str]] = set()
# httpx 默认空闲 5 秒就丢弃连接，工具稍慢一点下一轮就要重新解析域名和握手。
_KEEPALIVE_SECONDS = 30
_shared_http: Optional[tuple[asyncio.AbstractEventLoop, httpx.AsyncClient]] = None


def _http_client() -> httpx.AsyncClient:
    """同一事件循环内的模型请求共用连接池；连接绑定事件循环，不能跨循环复用。"""
    global _shared_http
    limits = httpx.Limits(max_connections=1000, max_keepalive_connections=100, keepalive_expiry=_KEEPALIVE_SECONDS)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return DefaultAsyncHttpxClient(limits=limits)
    if _shared_http is None or _shared_http[0] is not loop or _shared_http[1].is_closed:
        _shared_http = (loop, DefaultAsyncHttpxClient(limits=limits))
    return _shared_http[1]


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
        # 重试由 Harness 统一计数；SDK 内部重试不能绕过请求预算。
        kwargs.setdefault('max_retries', 0)
        if 'http_client' not in kwargs:
            kwargs['http_client'] = _http_client()
        endpoint = llm_config.selected_endpoint
        self.connection_endpoint = endpoint
        self._api_key = llm_config.api_key
        keyless = bool(endpoint and not endpoint.requires_key and not self._api_key)
        if keyless:
            from openai import Omit
            kwargs["default_headers"] = {**kwargs.get("default_headers", {}), "Authorization": Omit()}
        self._client = AsyncOpenAI(
            base_url=str(llm_config.base_url),
            api_key="xxxx" if keyless else self._api_key,
            **kwargs,
        )

        self._model_name = llm_config.model_name
        self.api_protocol = llm_config.api_protocol
        self._has_api_key = keyless or bool(self._api_key.strip() and self._api_key.strip() != "xxxx")
        self._temperature = llm_config.temperature
        from app.domain.models.model_catalog import find_model
        spec = find_model(llm_config.model_name, llm_config)
        self._custom = llm_config.custom_models.get(self._model_name)
        catalog_vendor = spec.provider if (spec is not None and not spec.custom) else None
        self._billing_vendor = catalog_vendor or (endpoint.kind if endpoint else None) or "compatible"
        self._billing_provider = (endpoint.provider if endpoint else None) or self._billing_vendor
        self.supports_tools = spec is None or spec.tools
        self.connection_snapshot = None
        self._provider = (self._billing_vendor if self._custom else spec.provider) if spec else 'openai'
        self.tool_batching = spec.tool_batching if spec else 'disabled'
        self._emit_thinking = True if spec is None else spec.emit_thinking
        self.supports_vision = bool(spec and spec.vision)
        self.image_loader = None
        reasoning_enabled = thinking == 'enabled' if self._provider == 'deepseek' else (
            (reasoning_effort or (spec.default_choice if spec else 'none')) != 'none')
        self._send_temperature = spec is None or (spec.temperature_when == "always" or
            spec.temperature_when == "disabled" and not reasoning_enabled)
        self._max_tokens = llm_config.max_tokens
        self._context_window = llm_config.context_window
        self._streaming = llm_config.streaming
        self._timeout = llm_config.request_timeout
        self._thinking = thinking
        self._reasoning_effort = reasoning_effort
        self._reasoning_id = reasoning_id
        self._keep_reasoning = thinking == "enabled" if keep_reasoning is None else keep_reasoning
        if self.api_protocol == 'responses' and reasoning_enabled:
            self._keep_reasoning = True
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
            on_progress: Optional[ProgressCallback] = None,
    ) -> LLMInvokeResult:
        """发起一次模型请求。流式路径逐段交出文本并按节流推送进展，返回值仍是组装后的完整结果。"""
        prefix = log_session_prefix()
        response_type = (response_format or {}).get("type") if response_format else None
        logger.info(
            f"{prefix}LLM请求 protocol={self.api_protocol} model={self._model_name} stream={self._streaming} tools={bool(tools)} "
            f"tool_choice={tool_choice} response_format={response_type}"
        )
        try:
            if not self._has_api_key:
                raise LLMRequestError(f"{self._model_name} 未配置 API Key")
            messages = await self._materialize_images(messages)
            if self.api_protocol == 'responses':
                return await self._account(self._invoke_responses(messages, tools, response_format, tool_choice, on_delta, on_progress, prefix))
            if not self._streaming:
                return await self._account(self._invoke_complete(messages, tools, response_format, tool_choice, prefix))
            try:
                return await self._account(self._invoke_stream(messages, tools, response_format, tool_choice, on_delta, on_progress, prefix))
            except APIStatusError as error:
                if self._custom or not self._include_stream_usage or not _rejects_stream_options(error):
                    raise
                self._include_stream_usage = False
                logger.warning("供应商拒绝 stream_options，后续请求不再携带 include_usage")
                return await self._account(self._invoke_stream(messages, tools, response_format, tool_choice, on_delta, on_progress, prefix))
        except LLMRequestError as error:
            message = redact_credentials(str(error), self._api_key)
            if message == str(error):
                raise
            raise LLMRequestError(message, retryable=error.retryable, status_code=error.status_code,
                                  context_exceeded=error.context_exceeded, reason=error.reason,
                                  connect_failed=error.connect_failed,
                                  usage=error.usage, service_tier=error.service_tier) from None
        except Exception as error:
            status_code = getattr(error, "status_code", None)
            message = (upstream_message(error.response, self._api_key) if isinstance(error, APIStatusError)
                       else redact_credentials(str(error), self._api_key))
            cause = redact_credentials(_cause_chain(error) or "", self._api_key)
            logger.error("%sLLM请求失败 status=%s protocol=%s error=%s cause=%s",
                         prefix, status_code, self.api_protocol, message, cause)
            safe_cause = error if _connect_failed(error) and all(
                redact_credentials(str(item), self._api_key) == str(item) for item in _causes(error)
            ) else None
            if isinstance(error, APIError) and not isinstance(error, APIStatusError):
                classified = response_error(getattr(error, 'code', None), message)
                if classified.retryable or classified.context_exceeded:
                    raise classified from None
            raise LLMRequestError(
                f"模型请求失败（HTTP {status_code}）：{message}" if status_code else f"模型请求失败：{message}",
                retryable=_is_transport_error(error),
                status_code=status_code,
                context_exceeded=_is_context_exceeded(error),
                connect_failed=_connect_failed(error),
            ) from safe_cause

    async def _account(self, request) -> LLMInvokeResult:
        started = utc_now()
        try:
            result = await request
        except (Exception, asyncio.CancelledError) as exc:
            exc_usage = getattr(exc, "usage", None)
            exc_tier = getattr(exc, "service_tier", None)
            charge = (
                token_charge(
                    self._billing_vendor, self._model_name, started, exc_usage,
                    self._custom.rates if self._custom else None, service_tier=exc_tier,
                )
                if exc_usage is not None
                else None
            )
            await record_usage(started, self._billing_provider, self._model_name, failed=True, usage=exc_usage, charge=charge)
            raise
        charge = token_charge(
            self._billing_vendor, self._model_name, started, result.usage,
            self._custom.rates if self._custom else None, service_tier=result.service_tier,
        )
        await record_usage(started, self._billing_provider, self._model_name, usage=result.usage, charge=charge)
        result.charge = charge
        return result

    def _responses_kwargs(self, messages, tools, response_format, tool_choice):
        kwargs = {'model': self._model_name, 'input': response_input(messages, self._model_name, self._provider),
                  'max_output_tokens': self._max_tokens, 'stream': self._streaming, 'timeout': self._timeout}
        if self._provider != 'deepseek' and not self._custom:
            kwargs.update(store=False, include=['reasoning.encrypted_content'])
        if self._send_temperature:
            kwargs['temperature'] = self._temperature
        effort = self._reasoning_effort
        if self._provider == 'deepseek' and self._thinking == 'disabled' and not self._custom:
            effort = 'none'
        if effort:
            reasoning_spec: Dict[str, Any] = {'effort': effort}
            endpoint_key = (str(getattr(self._client, 'base_url', '') or '').rstrip('/'), self._model_name)
            if self._provider != 'deepseek' and effort != 'none' and endpoint_key not in _SUMMARY_UNSUPPORTED:
                reasoning_spec['summary'] = 'auto'
            kwargs['reasoning'] = reasoning_spec
        if self._custom and self._emit_thinking and self._thinking in ("enabled", "disabled"):
            kwargs['extra_body'] = {"thinking": {"type": self._thinking}}
        if tools:
            kwargs['tools'] = response_tools(tools)
            if tool_choice:
                kwargs['tool_choice'] = tool_choice
            if self.tool_batching != 'provider_default':
                kwargs['parallel_tool_calls'] = self.tool_batching == 'enabled'
        if response_format:
            format_spec = copy.deepcopy(response_format)
            if format_spec.get('type') == 'json_schema':
                format_spec = {'type': 'json_schema', **format_spec['json_schema']}
            kwargs['text'] = {'format': format_spec}
        return kwargs

    async def _invoke_responses(self, messages, tools, response_format, tool_choice, on_delta, on_progress, prefix):
        started = asyncio.get_running_loop().time()
        kwargs = self._responses_kwargs(messages, tools, response_format, tool_choice)
        try:
            response = await self._client.responses.create(**kwargs)
        except APIStatusError as error:
            if (
                not isinstance(kwargs.get('reasoning'), dict)
                or 'summary' not in kwargs['reasoning']
                or not _rejects_reasoning_summary(error)
            ):
                raise
            endpoint_key = (str(getattr(self._client, 'base_url', '') or '').rstrip('/'), self._model_name)
            _SUMMARY_UNSUPPORTED.add(endpoint_key)
            logger.warning('%sResponses 供应商不支持 reasoning.summary，本次及后续请求自动降级省略 summary', prefix)
            kwargs = copy.deepcopy(kwargs)
            kwargs['reasoning'].pop('summary', None)
            response = await self._client.responses.create(**kwargs)
        ttft_ms = None
        first_any_at: Optional[float] = None
        first_visible_at: Optional[float] = None
        completed_at: Optional[float] = None
        emitter = _ProgressEmitter(on_progress)
        if self._streaming:
            stream, response = response, None
            try:
                chunks = self._iter_chunks(stream)
                async for event in chunks:
                    kind = _field(event, 'type')
                    now_t = asyncio.get_running_loop().time()
                    item = _field(event, 'item') if kind == 'response.output_item.added' else None
                    item_type = _field(item, 'type') if item is not None else None
                    is_visible = kind in ('response.output_text.delta', 'response.function_call_arguments.delta') or (
                        kind == 'response.output_item.added' and item_type == 'function_call')
                    is_activity = is_visible or kind in (
                        'response.reasoning_text.delta', 'response.reasoning_summary_text.delta'
                    ) or (kind == 'response.output_item.added' and item_type == 'reasoning')
                    if is_activity and first_any_at is None:
                        first_any_at = now_t
                    if kind == 'response.output_item.added' and item_type == 'reasoning':
                        await emitter.note_reasoning("", now_t)
                    elif kind in ('response.reasoning_text.delta', 'response.reasoning_summary_text.delta'):
                        await emitter.note_reasoning(_field(event, 'delta') or "", now_t)
                    elif kind == 'response.output_item.added' and item_type == 'function_call':
                        slot_key = _field(item, 'id') or _field(event, 'item_id') or _field(event, 'output_index') or 0
                        await emitter.note_tool_call(
                            slot_key,
                            name=_field(item, 'name'),
                            arg_chunk=_field(item, 'arguments') or "",
                            now=now_t,
                        )
                    elif kind == 'response.function_call_arguments.delta':
                        slot_key = _field(event, 'item_id') or _field(event, 'output_index') or 0
                        await emitter.note_tool_call(slot_key, arg_chunk=_field(event, 'delta') or "", now=now_t)
                    if is_visible:
                        if first_visible_at is None:
                            first_visible_at = now_t
                            ttft_ms = max(0, int((now_t - started) * 1000))
                        if kind == 'response.output_text.delta':
                            await emitter.flush_reasoning(now_t)
                            if on_delta and _field(event, 'delta'):
                                await on_delta(_field(event, 'delta'))
                    if kind == 'error':
                        logger.warning('%sResponses流失败', prefix)
                        raise response_error(_field(event, 'code'), _field(event, 'message') or '模型流错误')
                    if kind in ('response.completed', 'response.incomplete', 'response.failed'):
                        await emitter.flush_reasoning(now_t)
                        completed_at = asyncio.get_running_loop().time()
                        response = _field(event, 'response')
                        # 完整终态已收到。短暂读取尾部 [DONE]/EOF，使 HTTP 连接可复用；
                        # 不让迟迟不结束的 SSE 阻塞结果，也不重试已经完整收到的响应。
                        try:
                            async with asyncio.timeout(1):
                                async for _ in chunks:
                                    pass
                        except Exception as error:
                            logger.debug('%s模型完整终态后的尾部读取: %s', prefix, type(error).__name__)
                        break
            finally:
                close = getattr(stream, 'aclose', None) or getattr(stream, 'close', None)
                if close:
                    try:
                        await close()
                    except Exception as error:
                        logger.debug('%s关闭模型流: %r', prefix, error)
            if response is None:
                raise LLMRequestError('模型流在完整终态前结束', retryable=True, reason='stream_interrupted')
        result = response_result(response, self._model_name, self._provider, ttft_ms)
        result.decode_ms = _compute_decode_ms(first_any_at, first_visible_at, completed_at, result.usage)
        logger.info('%sLLM响应 protocol=responses model=%s finish_reason=%s tools=%s usage=%s',
                    prefix, self._model_name, result.finish_reason, len(result.message.get('tool_calls') or []),
                    result.usage.model_dump() if result.usage else None)
        return result

    async def _materialize_images(self, messages):
        messages = copy.deepcopy(messages)
        for message in messages:
            message.pop('_ray_visual', None)
            if self.api_protocol == 'chat_completions':
                message.pop('_ray_responses', None)
            if not isinstance(message.get('content'), list):
                continue
            for index, part in enumerate(message['content']):
                if part.get('type') != 'image_ref':
                    continue
                if not self.supports_vision or self.image_loader is None or message.get('role') != 'user':
                    raise LLMRequestError('当前模型或消息角色不支持图像输入')
                ref = part['image_ref']
                data = await self.image_loader(ref)
                message['content'][index] = {'type': 'image_url', 'image_url': {
                    'url': f"data:{ref['mime_type']};base64," + base64.b64encode(data).decode('ascii'),
                    'detail': ref.get('detail', 'high')}}
        return messages

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
            # DeepSeek 官方契约不声明此参数；使用厂商默认值，不伪称保证批量生成。
            if self.tool_batching != 'provider_default':
                kwargs['parallel_tool_calls'] = self.tool_batching == 'enabled'
        if stream:
            kwargs["stream"] = True
            if self._include_stream_usage:
                kwargs["stream_options"] = {"include_usage": True}
        if self._emit_thinking and self._thinking in ("enabled", "disabled"):
            kwargs["extra_body"] = {"thinking": {"type": self._thinking}}
        if self._reasoning_effort:
            kwargs["reasoning_effort"] = self._reasoning_effort
        return kwargs

    async def _invoke_complete(
            self,
            messages: List[Dict[str, Any]],
            tools: Optional[List[Dict[str, Any]]],
            response_format: Optional[Dict[str, Any]],
            tool_choice: Optional[str],
            prefix: str,
    ) -> LLMInvokeResult:
        response = await self._client.chat.completions.create(**self._request_kwargs(
            messages, tools, response_format, tool_choice, stream=False,
        ))
        choice = response.choices[0]
        message = choice.message
        usage = parse_completion_usage(getattr(response, "usage", None))
        tier = getattr(response, "service_tier", None)
        logger.info(
            f"{prefix}LLM响应 model={self._model_name} finish_reason={choice.finish_reason} "
            f"has_content={bool(message.content)} tool_calls={len(message.tool_calls or [])} "
            f"usage={usage.model_dump() if usage else None}"
        )
        return LLMInvokeResult(
            message=message.model_dump(), usage=usage, finish_reason=choice.finish_reason,
            service_tier=tier if isinstance(tier, str) else None,
        )

    async def _invoke_stream(
            self,
            messages: List[Dict[str, Any]],
            tools: Optional[List[Dict[str, Any]]],
            response_format: Optional[Dict[str, Any]],
            tool_choice: Optional[str],
            on_delta: Optional[DeltaCallback],
            on_progress: Optional[ProgressCallback],
            prefix: str,
    ) -> LLMInvokeResult:
        started = asyncio.get_running_loop().time()
        stream = await self._client.chat.completions.create(**self._request_kwargs(
            messages, tools, response_format, tool_choice, stream=True,
        ))
        assembly = _StreamAssembly()
        emitter = _ProgressEmitter(on_progress)
        ttft_ms: Optional[int] = None
        first_any_at: Optional[float] = None
        first_visible_at: Optional[float] = None
        last_chunk_at: Optional[float] = None
        try:
            async for chunk in self._iter_chunks(stream):
                text, visible, activity = assembly.add(chunk)
                now_t = asyncio.get_running_loop().time()
                if activity:
                    if first_any_at is None:
                        first_any_at = now_t
                    last_chunk_at = now_t
                if assembly.last_reasoning:
                    await emitter.note_reasoning(assembly.last_reasoning, now_t)
                for slot_idx, tool_name, arg_chunk in assembly.last_tool_updates:
                    await emitter.note_tool_call(slot_idx, name=tool_name, arg_chunk=arg_chunk, now=now_t)
                if visible:
                    if first_visible_at is None:
                        first_visible_at = now_t
                        ttft_ms = max(0, int((now_t - started) * 1000))
                if text:
                    await emitter.flush_reasoning(now_t)
                    if on_delta is not None:
                        await on_delta(text)
            await emitter.flush_reasoning()
        except LLMRequestError as error:
            if error.usage is None and assembly.usage is not None:
                error.usage = assembly.usage
                error.service_tier = assembly.service_tier
            raise
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
                usage=assembly.usage,
                service_tier=assembly.service_tier,
            )
        decode_ms = _compute_decode_ms(first_any_at, first_visible_at, last_chunk_at, assembly.usage)
        message = assembly.message()
        logger.info(
            f"{prefix}LLM响应 model={self._model_name} stream=True finish_reason={assembly.finish_reason} "
            f"has_content={bool(message.get('content'))} tool_calls={len(message.get('tool_calls') or [])} "
            f"ttft_ms={ttft_ms} decode_ms={decode_ms} usage={assembly.usage.model_dump() if assembly.usage else None}"
        )
        return LLMInvokeResult(
            message=message,
            usage=assembly.usage,
            finish_reason=assembly.finish_reason,
            ttft_ms=ttft_ms,
            decode_ms=decode_ms,
            service_tier=assembly.service_tier,
        )

    async def _iter_chunks(self, stream: Any):
        """分片间隔（含等待首个分片）超过 request_timeout 视为传输错误。

        SDK 只包装建立请求时的 httpx 异常；读流途中断开会原样抛出 httpx 异常。
        """
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
            except httpx.TransportError as e:
                raise LLMRequestError(
                    f"模型流传输中断: {e}",
                    retryable=True,
                    reason="stream_interrupted",
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
        self.service_tier: Optional[str] = None
        self.last_reasoning: str = ""
        self.last_tool_updates: List[tuple[int, Optional[str], str]] = []

    def add(self, chunk: Any) -> tuple[Optional[str], bool, bool]:
        """返回 (文本增量, 是否是可见文本或工具调用片段, 是否有任何生成活动含推理或终态)。"""
        self.last_reasoning = ""
        self.last_tool_updates = []
        tier = _field(chunk, "service_tier")
        if isinstance(tier, str) and tier:
            self.service_tier = tier
        parsed = parse_completion_usage(_field(chunk, "usage"))
        if parsed is not None:
            self.usage = parsed
        choices = _field(chunk, "choices") or []
        if not choices:
            return None, False, False
        choice = choices[0]
        finish = _field(choice, "finish_reason")
        if finish:
            self.finish_reason = str(finish)
        delta = _field(choice, "delta")
        if delta is None:
            return None, False, bool(finish)
        text: Optional[str] = None
        visible = False
        has_reasoning = False
        content = _field(delta, "content")
        if isinstance(content, str) and content:
            self._content.append(content)
            text = content
            visible = True
        reasoning = _field(delta, "reasoning_content")
        if isinstance(reasoning, str) and reasoning:
            self._reasoning.append(reasoning)
            self.last_reasoning = reasoning
            has_reasoning = True
        tool_calls = _field(delta, "tool_calls") or []
        if tool_calls:
            visible = True
            for raw in tool_calls:
                index = _field(raw, "index")
                slot_idx = 0 if index is None else int(index)
                slot = self._tools.setdefault(slot_idx, {
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
                self.last_tool_updates.append((slot_idx, slot["name"] or None, arguments or ""))
        return text, visible, visible or has_reasoning or bool(finish)

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


_TARGET_FIELD_RE = re.compile(r'"(filepath|path|file_path|name|query|url)"\s*:\s*"((?:\\.|[^"\\])*)"')


def _extract_tool_target(partial_args: str) -> Optional[str]:
    match = _TARGET_FIELD_RE.search(partial_args[:512])
    if not match:
        return None
    key, raw = match.group(1), match.group(2)
    try:
        value = json.loads(f'"{raw}"')
    except ValueError:
        value = raw
    value = str(value).strip()
    if not value:
        return None
    if key in ("filepath", "path", "file_path"):
        if "/" in value:
            value = PurePosixPath(value).name or value
        elif "\\" in value:
            value = value.rsplit("\\", 1)[-1] or value
    return value[:48]


class _ProgressEmitter:
    """对流式思考增量和工具参数生成做轻量节流聚合，避免逐字广播 SSE。"""

    def __init__(self, on_progress: Optional[ProgressCallback]) -> None:
        self._callback = on_progress
        self._reasoning_started = False
        self._reasoning_buf: List[str] = []
        self._last_reasoning_at: float = 0.0
        self._tools: Dict[Any, Dict[str, Any]] = {}

    async def note_reasoning(self, delta: str, now: Optional[float] = None) -> None:
        if self._callback is None:
            return
        now = asyncio.get_running_loop().time() if now is None else now
        if delta:
            self._reasoning_buf.append(delta)
        first = not self._reasoning_started
        self._reasoning_started = True
        buf_len = sum(len(part) for part in self._reasoning_buf)
        if first or buf_len >= 48 or (buf_len > 0 and now - self._last_reasoning_at >= 0.08):
            await self.flush_reasoning(now, force_empty=first)

    async def flush_reasoning(self, now: Optional[float] = None, *, force_empty: bool = False) -> None:
        if self._callback is None:
            self._reasoning_buf.clear()
            return
        text = "".join(self._reasoning_buf)
        if not text and not force_empty:
            return
        self._reasoning_buf.clear()
        self._last_reasoning_at = asyncio.get_running_loop().time() if now is None else now
        await self._callback(ModelProgress(phase="reasoning", delta=text))

    async def note_tool_call(
            self,
            slot_key: Any,
            *,
            name: Optional[str] = None,
            arg_chunk: str = "",
            now: Optional[float] = None,
    ) -> None:
        if self._callback is None:
            return
        now = asyncio.get_running_loop().time() if now is None else now
        await self.flush_reasoning(now)
        slot = self._tools.setdefault(slot_key, {
            "name": "", "prefix": "", "target": None, "bytes": 0, "last_emit": -1.0, "emitted": False,
        })
        important = False
        if name and name != slot["name"]:
            slot["name"] = name
            important = True
        if arg_chunk:
            slot["bytes"] += len(arg_chunk.encode("utf-8"))
            if len(slot["prefix"]) < 512:
                slot["prefix"] = (slot["prefix"] + arg_chunk)[:512]
            if slot["target"] is None:
                target = _extract_tool_target(slot["prefix"])
                if target:
                    slot["target"] = target
                    important = True
        if not slot["name"]:
            return
        if not slot["emitted"] or important or (now - slot["last_emit"] >= 0.25):
            slot["emitted"] = True
            slot["last_emit"] = now
            await self._callback(ModelProgress(
                phase="tool_call",
                tool_name=slot["name"],
                tool_target=slot["target"],
                arg_bytes=slot["bytes"],
            ))


def _compute_decode_ms(
    first_any_at: Optional[float],
    first_visible_at: Optional[float],
    completed_at: Optional[float],
    usage: Optional[LLMUsage],
) -> Optional[int]:
    """测算纯解码耗时：排除 1s 尾部排空与图片准备；未返回 reasoning_tokens 时起算点含思考阶段以对齐口径。"""
    if completed_at is None:
        return None
    has_reasoning_split = usage is not None and usage.reasoning_tokens is not None
    if not has_reasoning_split and first_any_at is not None and first_visible_at is not None and first_any_at < first_visible_at:
        start_at = first_any_at
    else:
        start_at = first_visible_at if first_visible_at is not None else first_any_at
    if start_at is None:
        return None
    return max(0, int((completed_at - start_at) * 1000))


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


def _rejects_reasoning_summary(error: Exception) -> bool:
    """上游兼容端点拒绝 reasoning.summary 时返回 400 并提及 summary。"""
    if _is_context_exceeded(error):
        return False
    if not isinstance(error, APIStatusError) or error.status_code != 400:
        return False
    text = f"{getattr(error, 'code', '') or ''} {error}".lower()
    return any(marker in text for marker in _SUMMARY_MARKERS)


def _causes(error: BaseException):
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        yield error
        error = error.__cause__ or error.__context__


def _cause_chain(error: BaseException) -> Optional[str]:
    return ' <- '.join(f'{type(item).__name__}: {item}' for item in list(_causes(error))[1:5]) or None


def _connect_failed(error: BaseException) -> bool:
    """httpx 的 ConnectError / ConnectTimeout 只在连接建立阶段抛出，此时请求还没有发出。"""
    return any(isinstance(item, (httpx.ConnectError, httpx.ConnectTimeout)) for item in _causes(error))


def _is_transport_error(error: Exception) -> bool:
    """连接、超时、限流与 5xx 可以重发；参数、鉴权、额度等错误重发也不会成功。"""
    if getattr(error, 'code', None) in {'insufficient_quota', 'billing_hard_limit_reached', 'invalid_api_key'}:
        return False
    if isinstance(error, (APIConnectionError, RateLimitError, InternalServerError, httpx.TransportError)):
        return True
    if isinstance(error, APIStatusError):
        return error.status_code == 429 or error.status_code >= 500
    if isinstance(error, APIError):
        return response_error(getattr(error, 'code', None), str(error)).retryable
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
