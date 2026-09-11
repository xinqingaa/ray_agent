#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""语言模型调用结果与用量。"""
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class LLMUsage(BaseModel):
    """单次 Chat Completions 调用的 token 用量；字段缺失表示服务未返回。"""
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

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
    """一次模型调用的消息与可选用量。"""
    message: Dict[str, Any] = Field(default_factory=dict)
    usage: Optional[LLMUsage] = None
