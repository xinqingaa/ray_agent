#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""语言模型调用结果与用量。"""
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class LLMUsage(BaseModel):
    """单次 Chat Completions 调用的 token 用量；字段缺失表示服务未返回。

    cached_tokens 取 ``prompt_tokens_details.cached_tokens``（DeepSeek 为 ``prompt_cache_hit_tokens``），
    reasoning_tokens 取 ``completion_tokens_details.reasoning_tokens``。
    """
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    cached_tokens: Optional[int] = None
    reasoning_tokens: Optional[int] = None

    @property
    def available(self) -> bool:
        return (
            self.prompt_tokens is not None
            or self.completion_tokens is not None
            or self.total_tokens is not None
        )

    @property
    def resolved_total(self) -> int:
        if self.total_tokens is not None:
            return self.total_tokens
        return (self.prompt_tokens or 0) + (self.completion_tokens or 0)


class LLMInvokeResult(BaseModel):
    """一次模型调用的消息、可选用量与结束原因。

    finish_reason 取服务端原值（stop / tool_calls / length / content_filter 等），未返回时为 None；
    值为 length 表示输出被 max_tokens 截断，消息内容与工具调用都可能不完整。
    流在结束原因前断开时适配层抛出可重试错误，不返回半截结果。
    ttft_ms 是从请求发出到第一个可见文本或工具调用片段的毫秒数；非流式路径为空。
    推理分片不计入首字，也不作为文本增量交出。
    """
    message: Dict[str, Any] = Field(default_factory=dict)
    usage: Optional[LLMUsage] = None
    finish_reason: Optional[str] = None
    ttft_ms: Optional[int] = None
