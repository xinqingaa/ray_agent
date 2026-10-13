"""Responses 的纯格式转换；执行与历史所有权仍由 Harness 管理。"""
import copy
from typing import Any

from app.domain.external.llm import LLMRequestError
from app.domain.models.llm import LLMInvokeResult, LLMUsage


def plain(value: Any) -> dict:
    return value if isinstance(value, dict) else value.model_dump(exclude_none=True)


def response_input(messages: list[dict], model: str, provider: str) -> list[dict]:
    items = []
    for message in messages:
        role = message.get('role')
        saved = message.get('_ray_responses') or {}
        if role == 'assistant' and saved.get('model') == model and saved.get('provider') == provider:
            items.extend(copy.deepcopy(saved['items']))
            continue
        if role == 'tool':
            items.append({'type': 'function_call_output', 'call_id': message['tool_call_id'],
                          'output': message.get('content') or ''})
            continue
        content = message.get('content')
        if isinstance(content, list):
            content = [({'type': 'input_image', **part['image_url']} if part.get('type') == 'image_url'
                        else {'type': 'output_text' if role == 'assistant' else 'input_text', 'text': part.get('text', '')})
                       for part in content]
            # Chat 的 image_url 内部字段 url，在 Responses 中叫 image_url。
            for part in content:
                if part['type'] == 'input_image':
                    part['image_url'] = part.pop('url')
        if role == 'assistant' and provider == 'deepseek' and message.get('reasoning_content'):
            items.append({'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': message['reasoning_content']}]})
        if content:
            items.append({'role': role, 'content': content})
        for call in message.get('tool_calls') or []:
            function = call['function']
            items.append({'type': 'function_call', 'call_id': call['id'],
                          'name': function['name'], 'arguments': function['arguments']})
    return items


def response_tools(tools: list[dict] | None) -> list[dict]:
    return [{'type': 'function', **copy.deepcopy(tool['function']), 'strict': False} for tool in tools or []]


def response_result(response: Any, model: str, provider: str, ttft_ms: int | None = None) -> LLMInvokeResult:
    raw = plain(response)
    status = raw.get('status')
    if status == 'failed':
        error = raw.get('error') or {}
        raise response_error(error.get('code'), error.get('message') or '模型响应失败')
    if status not in ('completed', 'incomplete'):
        raise LLMRequestError('模型响应缺少完整终态', retryable=True, reason='stream_interrupted')
    reason = (raw.get('incomplete_details') or {}).get('reason')
    if status == 'incomplete' and reason != 'max_output_tokens':
        raise LLMRequestError(f'模型响应未完成: {reason or "unknown"}')
    output = raw.get('output') or []
    content, reasoning, calls = [], [], []
    for item in output:
        kind = item.get('type')
        if kind == 'message':
            for part in item.get('content') or []:
                if part.get('type') == 'output_text':
                    content.append(part.get('text') or '')
                elif part.get('type') == 'refusal':
                    content.append(part.get('refusal') or '')
        elif kind == 'reasoning':
            reasoning.extend(part.get('text') or '' for part in item.get('content') or [] if part.get('type') == 'reasoning_text')
        elif kind == 'function_call':
            if status == 'incomplete':
                continue
            if not item.get('call_id') or not item.get('name'):
                raise LLMRequestError('模型工具调用缺少身份或名称')
            if status == 'completed' and item.get('status') not in (None, 'completed'):
                raise LLMRequestError('模型响应包含未完成的工具调用')
            if any(call['id'] == item['call_id'] for call in calls):
                raise LLMRequestError('模型响应包含重复的工具调用身份')
            calls.append({'id': item['call_id'], 'type': 'function', 'function': {
                'name': item['name'], 'arguments': item.get('arguments', '')}})
        else:
            raise LLMRequestError(f'模型返回了未支持的输出类型: {kind}')
    message = {'role': 'assistant', 'content': ''.join(content) or None,
               '_ray_responses': {'model': model, 'provider': provider, 'items': copy.deepcopy(output)}}
    if reasoning:
        message['reasoning_content'] = ''.join(reasoning)
    if calls:
        message['tool_calls'] = calls
    finish = 'length' if status == 'incomplete' and reason == 'max_output_tokens' else (
        'content_filter' if status == 'incomplete' else 'tool_calls' if calls else 'stop')
    usage = raw.get('usage')
    parsed = None if usage is None else LLMUsage(
        prompt_tokens=usage.get('input_tokens'), completion_tokens=usage.get('output_tokens'),
        total_tokens=usage.get('total_tokens'), cached_tokens=(usage.get('input_tokens_details') or {}).get('cached_tokens'),
        reasoning_tokens=(usage.get('output_tokens_details') or {}).get('reasoning_tokens'))
    return LLMInvokeResult(message=message, usage=parsed, finish_reason=finish, ttft_ms=ttft_ms)


def response_error(code: str | None, message: str) -> LLMRequestError:
    """结构化瞬时错误可重试；未知 bad_response 只允许已观测的两个准确消息。"""
    transient = code in {'server_error', 'internal_server_error', 'rate_limit_exceeded', 'service_unavailable',
                         'upstream_timeout', 'stream_interrupted'}
    interrupted = code == 'stream_interrupted'
    if code == 'bad_response':
        normalized = message.strip().rstrip('.').lower()
        interrupted = normalized == 'upstream response stream was interrupted'
        transient = interrupted or normalized == 'the service is temporarily unavailable. please retry later'
    return LLMRequestError(f'模型响应失败 ({code or "unknown"}): {message}', retryable=transient,
                           context_exceeded=code == 'context_length_exceeded',
                           reason='stream_interrupted' if interrupted else None)
