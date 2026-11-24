#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""应用内项目预览登记工具：把已生成的静态页面、静态目录或轻量本地脚本小工具登记为一键预览卡片。"""
from typing import Awaitable, Callable, Optional

from pydantic import BaseModel

from app.domain.models.tool_result import ToolResult
from app.domain.models.workspace_preview import PreviewKind, PreviewRuntimeState
from .base import BaseTool, tool

REGISTER_PREVIEW_TOOL = "register_preview"

RegisterPreviewFn = Callable[..., Awaitable[ToolResult]]


class RegisterPreviewResult(BaseModel):
    preview_id: str
    name: str
    kind: PreviewKind
    root_id: str
    relative_path: str = ""
    entry_path: str = ""
    state: PreviewRuntimeState
    port: Optional[int] = None
    preview_url: Optional[str] = None
    note: Optional[str] = None
    logs_tail: str = ""


class PreviewTool(BaseTool):
    name: str = "preview"

    def __init__(self, register_preview: Optional[RegisterPreviewFn] = None) -> None:
        super().__init__()
        self._register_preview = register_preview

    @tool(
        name=REGISTER_PREVIEW_TOOL,
        description=(
            "将已写入工作区或会话目录的可交互网页或轻量单进程本机小工具登记到应用内预览。"
            "严格按最小复杂度阶梯选用：纯前端可完成时首选单文件 HTML（kind=\"static\"）；"
            "需要拆分多文件但无需跨运行读写本机文件时次选静态目录（kind=\"static\"）；"
            "仅当明确需要本机文件持久化或执行本机数据处理脚本时，才启用轻量单进程本地脚本服务（kind=\"service\"）。"
            "注意：kind=\"service\" 会立即由系统分配空闲回环端口并注入环境变量 HOST=127.0.0.1 与 PORT，"
            "脚本必须绑定 HOST/127.0.0.1 并监听 PORT（禁止绑定 0.0.0.0 或硬编码固定端口），"
            "登记后系统自动启动并检查 health_path，通过后才可用。"
        ),
        parameters={
            "name": {
                "type": "string",
                "description": "展示给用户的简短项目名称（例如展示页或工具标题，不超过 80 字）",
            },
            "kind": {
                "type": "string",
                "enum": ["static", "service"],
                "description": "static 表示单 HTML 文件或纯静态目录；service 表示轻量单进程本地脚本服务",
            },
            "path": {
                "type": "string",
                "description": "已写入的目标文件或项目目录路径（工作区/会话目录内的绝对路径或相对路径）",
            },
            "entry_path": {
                "type": "string",
                "description": "(可选) kind=\"static\" 且 path 为目录时的入口 HTML 相对路径，默认 index.html",
            },
            "start_command": {
                "type": "string",
                "description": "(kind=\"service\" 必填) 单行轻量启动命令，如 python3 server.py 或 node server.js；需监听 HOST=127.0.0.1 和 PORT",
            },
            "health_path": {
                "type": "string",
                "description": "(可选) kind=\"service\" 的回环 HTTP 健康检查路径，必须以 / 开头，默认 /",
            },
            "note": {
                "type": "string",
                "description": "(可选) 展示在时间线预览卡上的一句使用提示",
            },
        },
        required=["name", "kind", "path"],
    )
    async def register_preview(
        self,
        name: str,
        kind: PreviewKind,
        path: str,
        entry_path: Optional[str] = None,
        start_command: Optional[str] = None,
        health_path: Optional[str] = None,
        note: Optional[str] = None,
    ) -> ToolResult[RegisterPreviewResult]:
        if self._register_preview is None:
            return ToolResult(success=False, message="当前运行未装配项目预览服务")
        return await self._register_preview(
            name=name,
            kind=kind,
            path=path,
            entry_path=entry_path,
            start_command=start_command,
            health_path=health_path,
            note=note,
        )
