#!/usr/bin/env python
# -*- coding: utf-8 -*-
import copy
from typing import Any, Dict, List, Optional

from app.domain.external.sandbox import Sandbox
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool


class ShellTool(BaseTool):
    """Shell工具箱，提供Shell交互相关功能"""
    name: str = "shell"

    def __init__(self, sandbox: Sandbox, default_exec_dir: str = "/home/ubuntu") -> None:
        """构造函数，完成Shell工具箱初始化。default_exec_dir 是省略 exec_dir 时的工作目录。"""
        super().__init__()
        self.sandbox = sandbox
        self.default_exec_dir = default_exec_dir

    def get_tools(self) -> List[Dict[str, Any]]:
        """schema 里写明省略 exec_dir 时实际使用的默认目录。"""
        if self._tools_cache is None:
            tools = copy.deepcopy(super().get_tools())
            for item in tools:
                function = item.get("function") or {}
                if function.get("name") != "shell_execute":
                    continue
                function["parameters"]["properties"]["exec_dir"]["description"] = (
                    "执行命令的工作目录（必须使用绝对路径）。"
                    f"省略时使用默认工作目录 {self.default_exec_dir}"
                )
            self._tools_cache = tools
        return self._tools_cache

    @tool(
        name="shell_execute",
        description="在指定 Shell 会话中执行命令。可用于运行代码、安装依赖包或文件管理。",
        parameters={
            "session_id": {
                "type": "string",
                "description": "目标 Shell 会话的唯一标识符",
            },
            "exec_dir": {
                "type": "string",
                "description": "执行命令的工作目录（必须使用绝对路径）。省略时使用默认工作目录",
            },
            "command": {
                "type": "string",
                "description": "要执行的 Shell 命令",
            },
        },
        required=["session_id", "command"],
    )
    async def shell_execute(
            self,
            session_id: str,
            command: str,
            exec_dir: Optional[str] = None,
    ) -> ToolResult:
        """执行shell脚本。未给出工作目录时使用构造时的默认目录。"""
        directory = exec_dir or self.default_exec_dir
        return await self.sandbox.exec_command(session_id, directory, command)

    @tool(
        name="shell_read_output",
        description="查看指定 Shell 会话的内容。用于检查命令执行结果或监控输出。",
        parameters={
            "session_id": {
                "type": "string",
                "description": "目标 Shell 会话的唯一标识符",
            },
        },
        required=["session_id"],
    )
    async def shell_read_output(self, session_id: str) -> ToolResult:
        """根据会话id查看Shell会话内容"""
        return await self.sandbox.read_shell_output(session_id)

    @tool(
        name="shell_wait_process",
        description="等待指定 Shell 会话中正在运行的进程返回，进程结束时直接返回退出码与输出；超时时返回目前的输出。"
                    "在运行耗时较长的命令后使用。",
        parameters={
            "session_id": {
                "type": "string",
                "description": "目标 Shell 会话的唯一标识符",
            },
            "seconds": {
                "type": "integer",
                "description": "可选参数, 等待时长（秒）",
            }
        },
        required=["session_id"],
    )
    async def shell_wait_process(self, session_id: str, seconds: Optional[int] = None) -> ToolResult:
        """等待指定shell会话中正在运行的进程返回。

        过长的 seconds 由沙箱适配按 HTTP 超时减去余量截断，避免客户端先于业务超时断开。
        结束或超时后再读一次会话输出并入结果，读取失败时只返回等待结果。
        """
        waited = await self.sandbox.wait_process(session_id, seconds)
        timed_out = not waited.success and "超时" in (waited.message or "")
        if not waited.success and not timed_out:
            return waited
        try:
            read = await self.sandbox.read_shell_output(session_id)
        except Exception:
            return waited
        output = read.data.get("output") if read.success and isinstance(read.data, dict) else None
        if output is None:
            return waited
        data = dict(waited.data) if isinstance(waited.data, dict) else {}
        data["output"] = output
        if waited.success:
            return ToolResult(success=True, message=waited.message, data=data)
        data["status"] = "running"
        return ToolResult(success=False, message=f"{waited.message}；进程仍在运行，以下是目前的输出", data=data)

    @tool(
        name="shell_write_input",
        description="向指定 Shell 会话中正在运行的进程写入输入。用于响应交互式命令提示符。",
        parameters={
            "session_id": {
                "type": "string",
                "description": "目标 Shell 会话的唯一标识符",
            },
            "input_text": {
                "type": "string",
                "description": "要写入进程的输入内容",
            },
            "press_enter": {
                "type": "boolean",
                "description": "输入后是否按下回车键",
            }
        },
        required=["session_id", "input_text", "press_enter"],
    )
    async def shell_write_input(
            self,
            session_id: str,
            input_text: str,
            press_enter: str,
    ) -> ToolResult:
        """向指定shell会话正在运行的进程写入输入"""
        return await self.sandbox.write_shell_input(session_id, input_text, press_enter)

    @tool(
        name="shell_kill_process",
        description="在指定 Shell 会话中终止正在运行的进程。用于停止长时间运行的进程或处理卡死的命令。",
        parameters={
            "session_id": {
                "type": "string",
                "description": "目标 Shell 会话的唯一标识符",
            },
        },
        required=["session_id"],
    )
    async def shell_kill_process(self, session_id: str) -> ToolResult:
        """在指定Shell会话中终止正在运行的进程"""
        return await self.sandbox.kill_process(session_id)
