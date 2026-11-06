"""公开网页读取端口：在核心中直接完成，不需要执行环境。"""
from typing import Protocol

from app.domain.models.tool_result import ToolResult


class WebPageReader(Protocol):

    async def fetch_webpage(self, url: str) -> ToolResult:
        """读取公开网页并整理正文；失败时返回 success=False 且 data.requires_browser 为真。"""
        ...
