#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/07 15:08
@Author  : thezehui@gmail.com
@File    : agent_executor.py
"""
import os
import uuid

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import a2a_pb2 as types
from openai import AsyncOpenAI


class DeepSeekAgent:
    @classmethod
    async def invoke(cls, query: str) -> str:
        client = AsyncOpenAI(
            base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com"),
            api_key=os.environ["LLM_API_KEY"],
        )
        try:
            response = await client.chat.completions.create(
                model=os.getenv("LLM_MODEL_NAME", "deepseek-reasoner"),
                messages=[{"role": "user", "content": query}],
            )
            return response.choices[0].message.content or ""
        finally:
            await client.close()


def text_message(text: str) -> types.Message:
    return types.Message(
        message_id=str(uuid.uuid4()),
        role=types.ROLE_AGENT,
        parts=[types.Part(text=text)],
    )


def query_from(context: RequestContext) -> str:
    if context.message is None:
        return ""
    return "".join(
        part.text for part in context.message.parts if part.HasField("text")
    )


class LabAgentExecutor(AgentExecutor):
    """默认确定性回复；设置 A2A_LAB_MODE=deepseek 后才访问模型。"""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        query = query_from(context)
        if os.getenv("A2A_LAB_MODE") == "deepseek":
            answer = await DeepSeekAgent.invoke(query)
        else:
            answer = f"A2A_LAB_OK:{query}"
        await event_queue.enqueue_event(text_message(answer))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError("本教学示例暂不实现远程取消")
