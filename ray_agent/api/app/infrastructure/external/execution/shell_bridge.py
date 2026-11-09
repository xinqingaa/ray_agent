"""把 ProcessExecutor 适配成 ShellTool 使用的会话式 Shell 接口。"""
from __future__ import annotations

import asyncio

import getpass
import logging
import os
import re
import socket
from typing import Optional

from app.domain.external.process_executor import ProcessOwner, ProcessSpec, ProcessState
from app.domain.models.identity import RootedPath
from app.domain.models.tool_result import ToolResult
from app.domain.services.file_scope import FileScope
from app.infrastructure.external.execution.env import detect_posix_shell
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor, UnknownRootError

logger = logging.getLogger(__name__)

EXEC_FOREGROUND_SECONDS = 5
SHELL_WAIT_MAX_SECONDS = 570
_ANSI = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def bound_shell_wait_seconds(seconds: Optional[int]) -> Optional[int]:
    if seconds is None:
        return None
    try:
        value = int(seconds)
    except (TypeError, ValueError):
        return seconds
    return min(value, SHELL_WAIT_MAX_SECONDS) if value > 0 else seconds


class LocalShellBridge:
    """按 session_id 管理交互 Shell；语义对齐原沙箱 ShellService。"""

    def __init__(
            self,
            executor: SupervisedProcessExecutor,
            *,
            root_id: str | None = None,
            root_location: str | None = None,
            owner: ProcessOwner | None = None,
            files: FileScope | None = None,
            session_id: str | None = None,
            run_id: str | None = None,
            on_session=None,
            before_start=None, on_close=None,
    ) -> None:
        self._executor = executor
        self._before_start, self._on_close = before_start, on_close
        self.closed = False
        self._start_lock = asyncio.Lock()
        self._files = files
        self._on_session = on_session
        self._sessions: dict[str, str] = {}
        self._commands: dict[str, list[dict]] = {}
        if files is not None:
            for root in files.roots:
                executor.register_root(root.root_id, root.path)
            self._root_id = files.working.root_id if files.working else files.roots[0].root_id
            self._root_location = files.working.path if files.working else files.roots[0].path
            self._owner = ProcessOwner(session_id=session_id or "", run_id=run_id)
        else:
            if not root_id or not root_location or owner is None:
                raise ValueError("需要 root_id、root_location 与 owner，或传入 files")
            executor.register_root(root_id, root_location)
            self._root_id = root_id
            self._root_location = os.path.realpath(root_location)
            self._owner = owner

    def _ps1(self, exec_dir: str) -> str:
        home = os.path.expanduser("~")
        display = exec_dir.replace(home, "~", 1) if exec_dir.startswith(home) else exec_dir
        return f"{getpass.getuser()}@{socket.gethostname()}:{display} $"

    def _resolve_exec_dir(self, exec_dir: str) -> RootedPath | ToolResult:
        if self._files is not None:
            try:
                return self._files.resolve(exec_dir)
            except Exception as error:
                return ToolResult(success=False, message=str(error))
        if not exec_dir or not os.path.isdir(exec_dir):
            return ToolResult(success=False, message=f"目录不存在: {exec_dir}")
        try:
            relative = self._executor.relative_to_root(self._root_id, exec_dir)
        except UnknownRootError:
            return ToolResult(success=False, message="工作目录越出了可访问根")
        return RootedPath(root_id=self._root_id, relative_path=relative)

    async def exec_command(self, session_id: str, exec_dir: str, command: str) -> ToolResult:
        resolved = self._resolve_exec_dir(exec_dir)
        if isinstance(resolved, ToolResult):
            return resolved
        async def start():
            async with self._start_lock:
                if self.closed:
                    raise RuntimeError('本次运行的 Shell 已结束')
                if session_id in self._sessions:
                    old = await self._executor.kill_tree(self._sessions[session_id])
                    if old.state is ProcessState.LOST:
                        raise RuntimeError('旧 Shell 会话尚未确认结束，不能替换')
                if self._before_start:
                    await self._before_start()
                if self.closed:
                    raise RuntimeError("本次运行已停止，不再启动进程")
                status = await self._executor.start(ProcessSpec(
                    shell_command=command,
                    cwd=resolved,
                    owner=self._owner,
                    interactive=True,
                    env={"SHELL": detect_posix_shell()},
                ))
                self._sessions[session_id] = status.process_id
                return status
        starting = asyncio.create_task(start())
        try:
            status = await asyncio.shield(starting)
        except asyncio.CancelledError:
            self.closed = True
            try:
                await starting
            except Exception:
                pass
            finally:
                await self.destroy()
            raise
        self._commands.setdefault(session_id, []).append({
            "ps1": self._ps1(exec_dir), "command": command, "output": "",
        })
        if self._on_session:
            self._on_session(session_id)
        waited = await self._executor.wait(status.process_id, EXEC_FOREGROUND_SECONDS)
        if waited.state is not ProcessState.RUNNING:
            output = await self._executor.read_output(status.process_id)
            text = _ANSI.sub("", output.text)
            self._commands[session_id][-1]["output"] = text
            return ToolResult(success=True, message="success", data={
                "session_id": session_id, "command": command, "status": "completed",
                "returncode": waited.exit_code, "output": text,
            })
        return ToolResult(success=True, message="success", data={
            "session_id": session_id, "command": command, "status": "running",
        })

    async def read_shell_output(self, session_id: str, console: bool = False) -> ToolResult:
        process_id = self._sessions.get(session_id)
        if process_id is None:
            return ToolResult(success=False, message=f"Shell 会话不存在: {session_id}")
        output = await self._executor.read_output(process_id)
        clean = _ANSI.sub("", output.text)
        if self._commands.get(session_id):
            self._commands[session_id][-1]["output"] = clean
        data: dict = {"session_id": session_id, "output": clean, "console_records": []}
        if console:
            data["console_records"] = list(self._commands.get(session_id) or [])
        return ToolResult(success=True, message="success", data=data)

    async def wait_process(self, session_id: str, seconds: Optional[int] = None) -> ToolResult:
        process_id = self._sessions.get(session_id)
        if process_id is None:
            return ToolResult(success=False, message=f"Shell 会话不存在: {session_id}")
        bounded = bound_shell_wait_seconds(seconds)
        timeout = 60.0 if bounded is None or bounded <= 0 else float(bounded)
        status = await self._executor.wait(process_id, timeout)
        if status.state is ProcessState.RUNNING:
            return ToolResult(success=False, message=f"Shell 会话进程等待超时: {int(timeout)}s",
                              data={"returncode": None, "status": "running"})
        return ToolResult(success=True, message="success",
                          data={"returncode": status.exit_code, "status": "completed"})

    async def write_shell_input(self, session_id: str, input_text: str,
                                press_enter: bool = True) -> ToolResult:
        process_id = self._sessions.get(session_id)
        if process_id is None:
            return ToolResult(success=False, message=f"Shell 会话不存在: {session_id}")
        text = input_text + ("\n" if press_enter else "")
        try:
            status = await self._executor.status(process_id)
            if status.state is not ProcessState.RUNNING:
                return ToolResult(success=False, message="进程已结束")
            await self._executor.write_input(process_id, text)
        except Exception as error:
            return ToolResult(success=False, message=str(error))
        return ToolResult(success=True, message="success", data={"status": "success"})

    async def kill_process(self, session_id: str) -> ToolResult:
        process_id = self._sessions.get(session_id)
        if process_id is None:
            return ToolResult(success=False, message=f"Shell 会话不存在: {session_id}")
        # Shell 主进程退出不代表后台后代已经退出；由 supervisor 确认整棵树。
        status = await self._executor.kill_tree(process_id)
        ok = status.state != ProcessState.LOST
        return ToolResult(success=ok, message="success" if ok else "无法确认进程已结束", data={
            "status": "terminated" if ok else "lost",
            "returncode": status.exit_code if status.exit_code is not None else -9,
        })


    async def destroy(self) -> bool:
        """阻止新命令，确认所有会话的整棵树消失；未知结果保留写入阻止。"""
        async with self._start_lock:
            self.closed = True
            confirmed = True
            for process_id in list(self._sessions.values()):
                try:
                    status = await self._executor.kill_tree(process_id)
                    confirmed = confirmed and status.state is not ProcessState.LOST
                except Exception:
                    logger.exception('无法确认 Shell 子树结束 process=%s', process_id)
                    confirmed = False
            if self._on_close:
                await self._on_close(confirmed)
            return confirmed
