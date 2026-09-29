#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional, Union, List

from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool


ASK_USER_TOOL = "message_ask_user"


class MessageTool(BaseTool):
    """消息工具。提问由 Agent 循环拦截：发出问题并等待，用户回复在续接时写为该调用的结果。

    进度不再通过工具通知，助手随工具调用附带的文本与计划清单承担这一职责。
    """
    name: str = "message"

    def __init__(self) -> None:
        """构造函数，完成消息工具包初始化"""
        super().__init__()

    @tool(
        name=ASK_USER_TOOL,
        description="向用户提问并等待回复。只在缺少必要信息且无法合理假设时使用；调用后本轮暂停，用户的回复会作为本调用的结果返回。",
        parameters={
            "text": {
                "type": "string",
                "description": "要展示给用户的问题文本",
            },
            "attachments": {
                "anyOf": [
                    {"type": "string"},
                    {"items": {"type": "string"}, "type": "array"},
                ],
                "description": "(可选)与问题相关的文件或参考资料",
            },
            "suggest_user_takeover": {
                "type": "string",
                "enum": ["none", "browser"],
                "description": "(可选)建议用户接管的操作（例如由用户在浏览器中手动完成某些事）。"
            },
        },
        required=["text"],
    )
    async def message_ask_user(
            self,
            text: str,
            attachments: Optional[Union[str, List[str]]] = None,
            suggest_user_takeover: Optional[str] = None,
    ) -> ToolResult:
        """提问用户并等待响应"""
        return ToolResult(success=True)
