#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/27 9:43
@Author  : thezehui@gmail.com
@File    : mcp.py
"""
from app.domain.models.tool_result import ToolResult
from .base import BaseTool
from .protocol_gateway import MCPGateway


class MCPTool(BaseTool):
    """向主循环提供已发现工具的精确名称映射。"""
    name = "mcp"

    def __init__(self, gateway: MCPGateway):
        super().__init__()
        self.gateway = gateway
        self._tools = []

    async def initialize(self):
        await self.gateway.initialize()
        self._tools = await self.gateway.get_all_tools()

    def get_tools(self) -> list[dict]:
        return self._tools

    def has_tool(self, name: str) -> bool:
        return any(item["function"]["name"] == name for item in self._tools)

    async def invoke(self, tool_name: str, **kwargs) -> ToolResult:
        return await self.gateway.invoke(tool_name, kwargs)

    async def cleanup(self):
        try:
            await self.gateway.cleanup()
        finally:
            self._tools = []
