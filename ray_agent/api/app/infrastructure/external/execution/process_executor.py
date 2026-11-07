"""ProcessExecutor 的 supervisor 实现：位置在核心侧解析为绝对路径，进程由 supervisor 启动、跟踪与结束。"""
import os
from collections.abc import Mapping
from typing import Optional

from app.domain.external.process_executor import (
    ProcessId, ProcessOutput, ProcessOwner, ProcessSpec, ProcessStatus, ShellDialect, ShellInfo,
)
from app.domain.models.identity import RelativePath, RootedPath, relative_parts

from .env import detect_posix_shell
from .supervisor_client import SupervisorClient, SupervisorUnavailable

CALL_MARGIN_SECONDS = 15.0  # 客户端等待响应的余量，超过业务等待时长后才视为 supervisor 失联


class UnknownRootError(ValueError):
    """位置引用了未登记的可访问根，或解析后越出了根。"""


class SupervisedProcessExecutor:
    def __init__(self, client: SupervisorClient, roots: Optional[Mapping[str, str]] = None) -> None:
        self.client = client
        self._roots: dict[str, str] = {
            root_id: os.path.realpath(location) for root_id, location in (roots or {}).items()
        }

    def register_root(self, root_id: str, location: str) -> None:
        """登记可访问根的绝对位置；根的授权与有效性由登记方保证。"""
        self._roots[root_id] = os.path.realpath(location)

    def unregister_root(self, root_id: str) -> None:
        self._roots.pop(root_id, None)

    def resolve(self, path: RootedPath) -> str:
        root = self._roots.get(path.root_id)
        if root is None:
            raise UnknownRootError(f"可访问根未登记: {path.root_id}")
        resolved = os.path.realpath(os.path.join(root, *relative_parts(path.relative_path)))
        if resolved != root and not resolved.startswith(root.rstrip(os.sep) + os.sep):
            raise UnknownRootError("工作目录越出了可访问根")
        return resolved

    def relative_to_root(self, root_id: str, absolute: str) -> RelativePath:
        """把根内的绝对路径转换为相对路径；不在根内时抛出 UnknownRootError。"""
        root = self._roots.get(root_id)
        if root is None:
            raise UnknownRootError(f"可访问根未登记: {root_id}")
        resolved = os.path.realpath(absolute)
        if resolved == root:
            return ""
        prefix = root.rstrip(os.sep) + os.sep
        if not resolved.startswith(prefix):
            raise UnknownRootError("目录不在可访问根内")
        return resolved[len(prefix):].replace(os.sep, "/")

    async def shell_info(self) -> ShellInfo:
        return ShellInfo(dialect=ShellDialect.POSIX, program=detect_posix_shell())

    async def start(self, spec: ProcessSpec) -> ProcessStatus:
        result = await self.client.call("start", {
            "argv": spec.argv,
            "shell_command": spec.shell_command,
            "cwd": self.resolve(spec.cwd),
            "env": spec.env,
            "owner": spec.owner.model_dump(exclude_none=True),
            "interactive": spec.interactive,
        })
        return ProcessStatus(**result)

    async def status(self, process_id: ProcessId) -> ProcessStatus:
        return ProcessStatus(**await self.client.call("status", {"process_id": process_id}))

    async def read_output(self, process_id: ProcessId, offset: int = 0) -> ProcessOutput:
        return ProcessOutput(**await self.client.call("read_output", {"process_id": process_id, "offset": offset}))

    async def write_input(self, process_id: ProcessId, text: str, echo: bool = True) -> None:
        """echo 为真时 supervisor 把写入内容追加到输出，让读取方看到无终端时不会出现的回显。"""
        await self.client.call("write_input", {"process_id": process_id, "text": text, "echo": echo})

    async def wait(self, process_id: ProcessId, timeout_seconds: float | None = None) -> ProcessStatus:
        call_timeout = None if timeout_seconds is None else timeout_seconds + CALL_MARGIN_SECONDS
        return ProcessStatus(**await self.client.call(
            "wait", {"process_id": process_id, "timeout_seconds": timeout_seconds}, timeout=call_timeout))

    async def stop_tree(self, process_id: ProcessId, grace_seconds: float) -> ProcessStatus:
        return ProcessStatus(**await self.client.call(
            "stop_tree", {"process_id": process_id, "grace_seconds": grace_seconds},
            timeout=grace_seconds + CALL_MARGIN_SECONDS))

    async def kill_tree(self, process_id: ProcessId) -> ProcessStatus:
        return ProcessStatus(**await self.client.call("kill_tree", {"process_id": process_id},
                                                      timeout=CALL_MARGIN_SECONDS))

    async def register_external(self, pid: int, owner: ProcessOwner) -> ProcessStatus:
        """登记核心已创建的进程（如 MCP stdio 服务），之后可经 kill_tree 结束其整棵进程树。"""
        return ProcessStatus(**await self.client.call(
            "register_external", {"pid": pid, "owner": owner.model_dump(exclude_none=True)}))

    async def ping(self) -> dict:
        return await self.client.call("ping", timeout=CALL_MARGIN_SECONDS)

    async def shutdown(self) -> None:
        """请 supervisor 结束全部进程并退出；随后连接被对端关闭属于正常。"""
        try:
            await self.client.call("shutdown", timeout=CALL_MARGIN_SECONDS)
        except SupervisorUnavailable:
            pass
        finally:
            await self.client.close()
