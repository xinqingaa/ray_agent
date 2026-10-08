#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional, Tuple

from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool
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
        return [*super().get_tools(), *self._tools]

    def has_tool(self, name: str) -> bool:
        return any(item["function"]["name"] == name for item in self.get_tools())

    def route(self, name: str) -> Optional[Tuple[str, str]]:
        """模型可见的工具别名对应的 (服务名, 服务端原始工具名)；未知时为 None。"""
        route = getattr(self.gateway, "route", None)
        return route(name) if callable(route) else None

    async def invoke(self, tool_name: str, **kwargs) -> ToolResult:
        if tool_name == "discover_mcp_tools":
            return await super().invoke(tool_name, **kwargs)
        return await self.gateway.invoke(tool_name, kwargs)

    @tool('discover_mcp_tools', '列出可用 MCP 服务；指定 server 才连接该服务并展开工具。发现不执行业务动作，调用仍需授权。',
          {'server': {'type': 'string', 'description': '省略时仅返回离线服务目录'}}, [])
    async def discover_mcp_tools(self, server=None):
        config = getattr(self.gateway, 'config', None)
        directory = [name for name, item in (config.mcpServers.items() if config else []) if item.enabled]
        if server is None:
            return ToolResult(data={'servers': directory})
        if server not in directory:
            return ToolResult(success=False, message='未知或已禁用的 MCP 服务')
        await self.gateway.discover(server)
        self._tools = await self.gateway.get_all_tools()
        error = self.gateway.errors.get(server)
        return ToolResult(success=not error, message=error or '工具定义已加入下一请求',
                          data={'server': server, 'tools': [t['function']['name'] for t in self._tools
                                if self.route(t['function']['name'])[0] == server]})

    async def cleanup(self):
        try:
            await self.gateway.cleanup()
        finally:
            self._tools = []
