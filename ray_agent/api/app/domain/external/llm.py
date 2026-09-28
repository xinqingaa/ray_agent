#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/17 17:14
@Author  : thezehui@gmail.com
@File    : llm.py
"""
from typing import Protocol, List, Dict, Any, Optional

from app.domain.models.llm import LLMInvokeResult


class LLMRequestError(Exception):
    """模型请求失败。retryable 为 True 表示传输类错误（连接、超时、5xx、限流），可以原样重发。"""

    def __init__(self, message: str, *, retryable: bool = False, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


class LLM(Protocol):
    """用于Agent应用与LLM进行交互的接口协议"""

    async def invoke(
            self,
            messages: List[Dict[str, Any]],
            tools: List[Dict[str, Any]] = None,
            response_format: Dict[str, Any] = None,
            tool_choice: str = None,
    ) -> LLMInvokeResult:
        """传递消息列表、工具列表、响应格式、工具选择策略调用LLM接口"""
        ...

    @property
    def model_name(self) -> str:
        """只读属性，返回LLM的名字"""
        ...

    @property
    def temperature(self) -> float:
        """只读属性，返回LLM的温度"""
        ...

    @property
    def max_tokens(self) -> int:
        """只读属性，返回LLM的最大生成token数"""
        ...

    @property
    def context_window(self) -> int:
        """只读属性，返回模型上下文窗口（输入+输出总容量）"""
        ...
