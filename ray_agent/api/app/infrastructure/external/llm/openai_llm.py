#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/17 17:21
@Author  : thezehui@gmail.com
@File    : openai_llm.py
"""
import logging
from typing import List, Dict, Any

from openai import AsyncOpenAI

from app.application.errors.exceptions import ServerRequestsError
from app.domain.external.llm import LLM
from app.domain.models.app_config import LLMConfig
from app.infrastructure.logging import log_session_prefix

logger = logging.getLogger(__name__)


class OpenAILLM(LLM):
    """基于OpenAI SDK/兼容OpenAI格式的LLM调用类"""

    def __init__(self, llm_config: LLMConfig, **kwargs) -> None:
        """构造函数，完成异步OpenAI客户端的创建和参数初始化"""
        # 1.初始化异步客户端
        self._client = AsyncOpenAI(
            base_url=str(llm_config.base_url),
            api_key=llm_config.api_key,
            **kwargs,
        )

        # 2.完成其他参数的存储
        self._model_name = llm_config.model_name
        self._temperature = llm_config.temperature
        self._max_tokens = llm_config.max_tokens
        self._timeout = 3600

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def temperature(self) -> float:
        return self._temperature

    @property
    def max_tokens(self) -> int:
        return self._max_tokens

    async def invoke(
            self,
            messages: List[Dict[str, Any]],
            tools: List[Dict[str, Any]] = None,
            response_format: Dict[str, Any] = None,
            tool_choice: str = None,
    ) -> Dict[str, Any]:
        """使用异步OpenAI客户端发起块响应（该步骤可以切换成流式响应）"""
        prefix = log_session_prefix()
        response_type = (response_format or {}).get("type") if response_format else None
        try:
            # 1.检测是否传递了工具列表
            logger.info(
                f"{prefix}LLM请求 model={self._model_name} tools={bool(tools)} "
                f"tool_choice={tool_choice} response_format={response_type}"
            )
            if tools:
                response = await self._client.chat.completions.create(
                    model=self._model_name,
                    temperature=self._temperature,
                    max_tokens=self._max_tokens,
                    messages=messages,
                    response_format=response_format,
                    tools=tools,
                    tool_choice=tool_choice,
                    parallel_tool_calls=False,  # 关闭并行工具调用(deepseek没有这个参数的)
                    timeout=self._timeout,
                )
            else:
                # 2.为传递工具则删除tools/tool_choice等参数
                response = await self._client.chat.completions.create(
                    model=self._model_name,
                    temperature=self._temperature,
                    max_tokens=self._max_tokens,
                    messages=messages,
                    response_format=response_format,
                    timeout=self._timeout,
                )

            # 3.处理响应数据并返回
            message = response.choices[0].message
            logger.info(
                f"{prefix}LLM响应 model={self._model_name} "
                f"has_content={bool(message.content)} has_tool_calls={bool(message.tool_calls)}"
            )
            logger.debug(f"{prefix}LLM完整响应: {response.model_dump()}")
            return message.model_dump()
        except Exception as e:
            logger.error(
                f"{prefix}LLM请求失败 status={getattr(e, 'status_code', None)} "
                f"code={getattr(e, 'code', None)} error={e}"
            )
            raise ServerRequestsError(f"调用OpenAI客户端向LLM发起请求出错: {str(e)}")


if __name__ == "__main__":
    import asyncio


    async def main():
        llm = OpenAILLM(LLMConfig(
            base_url="https://api.deepseek.com",
            api_key="",
            model_name="deepseek-chat",
        ))
        response = await llm.invoke([{"role": "user", "content": "Hi"}])
        print(response)


    asyncio.run(main())
