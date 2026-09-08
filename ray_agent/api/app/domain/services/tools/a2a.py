#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/09 10:14
@Author  : thezehui@gmail.com
@File    : a2a.py
"""
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool
from .protocol_gateway import A2AGateway


class A2ATool(BaseTool):
    name = "a2a"

    def __init__(self, gateway: A2AGateway):
        super().__init__()
        self.gateway = gateway

    async def initialize(self):
        await self.gateway.initialize()

    async def cleanup(self):
        await self.gateway.cleanup()

    @tool(name="get_remote_agent_cards", description="获取已启用且连接成功的远程 Agent；id 是委派调用标识，card 包含技能。",
          parameters={}, required=[])
    async def get_remote_agent_cards(self) -> ToolResult:
        return ToolResult(message="远程 Agent 列表", data=self.gateway.cards)

    @tool(name="call_remote_agent", description="委派 query 给指定 id 的远程 Agent，并等待完成。检查 success 和远程状态；失败或超时不要自动重复提交。",
          parameters={"id": {"type": "string", "description": "get_remote_agent_cards 返回的 id"},
                      "query": {"type": "string", "description": "委派任务"}}, required=["id", "query"])
    async def call_remote_agent(self, id: str, query: str) -> ToolResult:
        return await self.gateway.invoke(id, query)
