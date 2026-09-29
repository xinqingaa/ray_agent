#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional, Tuple

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

    def route(self, name: str) -> Optional[Tuple[str, str]]:
        """模型可见的工具别名对应的 (服务名, 服务端原始工具名)；未知时为 None。"""
        route = getattr(self.gateway, "route", None)
        return route(name) if callable(route) else None

    async def invoke(self, tool_name: str, **kwargs) -> ToolResult:
        return await self.gateway.invoke(tool_name, kwargs)

    async def cleanup(self):
        try:
            await self.gateway.cleanup()
        finally:
            self._tools = []
