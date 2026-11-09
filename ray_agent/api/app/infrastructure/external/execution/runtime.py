"""本机执行运行时：supervisor、ProcessExecutor、组件与浏览器会话的进程内装配。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from app.domain.external.browser_session import BrowserProfile
from app.domain.external.process_executor import ProcessOwner
from app.domain.models.capability import UnavailableReason
from app.domain.services.file_scope import FileScope
from app.infrastructure.external.browser.local_session import DeferredBrowserSession, LocalBrowserSession
from app.infrastructure.external.components.local_components import BROWSER_ID, LocalRuntimeComponents
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import (
    configure_executor, ensure_supervisor, get_executor, ping, socket_path_for,
)
from core.paths import RESOURCE_ROOT, data_root
from app.infrastructure.external.execution.tool_runtimes import runtime_bin_dirs, ensure_tool_runtimes

logger = logging.getLogger(__name__)

_components: LocalRuntimeComponents | None = None
_shells: dict[str, LocalShellBridge] = {}
_browsers: dict[str, DeferredBrowserSession] = {}


def get_components() -> LocalRuntimeComponents:
    global _components
    if _components is None or _components.root != data_root().components:
        _components = LocalRuntimeComponents(data_root().components)
    return _components


async def get_process_executor() -> SupervisedProcessExecutor:
    bins = await ensure_tool_runtimes()
    existing = get_executor()
    if existing is not None and existing.client._socket == socket_path_for(data_root().root):
        sock = socket_path_for(data_root().root)
        if await ping(sock) is not None:
            return existing
    sock = await ensure_supervisor(data_root().root, bins)
    executor = SupervisedProcessExecutor(SupervisorClient(sock), {})
    configure_executor(executor)
    return executor


async def command_available() -> tuple[bool, str]:
    try:
        if len(runtime_bin_dirs()) != 2:
            return False, "基础工具运行时缺失，请重新安装完整应用；开发环境先准备工具运行时"
        return True, "本机工具运行时已就绪，执行时启动 supervisor"
    except Exception as error:
        logger.warning("执行 supervisor 不可用: %s", error)
        return False, f"执行 supervisor 不可用：{error}"


async def browser_available() -> tuple[bool, UnavailableReason | None, str]:
    try:
        components = get_components()
        status = await components.status(BROWSER_ID)
    except Exception as error:
        return False, UnavailableReason.COMPONENT_MISSING, str(error)
    if status.state.value == "available":
        return True, None, "浏览器组件可用"
    if status.state.value in ("fetching", "verifying"):
        return False, UnavailableReason.COMPONENT_MISSING, "浏览器组件安装中"
    return False, UnavailableReason.COMPONENT_MISSING, status.error.message if status.error else "浏览器组件未安装"


async def open_shell(
        *,
        files: FileScope,
        session_id: str,
        run_id: str,
        on_session=None, before_start=None, on_close=None,
) -> LocalShellBridge:
    existing = _shells.get(run_id)
    if existing is not None and not existing.closed:
        return existing
    executor = await get_process_executor()
    async def closed(confirmed):
        if on_close:
            await on_close(confirmed)
        if confirmed:
            _shells.pop(run_id, None)
    shell = LocalShellBridge(executor, files=files, session_id=session_id, run_id=run_id,
                             on_session=on_session, before_start=before_start, on_close=closed)
    _shells[run_id] = shell
    return shell


async def open_browser_session(
        *,
        workspace_id: str | None,
        session_id: str | None,
        run_id: str,
        download_dir: Path | None = None,
) -> DeferredBrowserSession:
    if run_id in _browsers:
        return _browsers[run_id]
    profile = BrowserProfile(workspace_id=workspace_id, session_id=session_id if workspace_id is None else None)
    session = LocalBrowserSession(
        get_components(), data_root().browser_profiles, download_dir=download_dir,
        executor_factory=get_process_executor, owner=ProcessOwner(session_id=session_id, run_id=run_id))
    deferred = DeferredBrowserSession(session, profile, on_close=lambda: _browsers.pop(run_id, None))
    _browsers[run_id] = deferred
    return deferred


async def register_external_pid(pid: int, owner: ProcessOwner) -> Optional[str]:
    """登记核心已拉起的外部进程（如 MCP stdio），失败只记日志不阻断业务。"""
    try:
        executor = await get_process_executor()
        status = await executor.register_external(pid, owner)
        return status.process_id
    except Exception:
        logger.exception("登记外部进程失败 pid=%s", pid)
        return None


async def close_runtime_sessions() -> None:
    for resource in [*_shells.values(), *_browsers.values()]:
        try:
            await resource.destroy() if isinstance(resource, LocalShellBridge) else await resource.stop()
        except Exception:
            logger.exception('关闭本机执行资源失败')
    _shells.clear()
    _browsers.clear()


async def stop_run_resources(run_id: str) -> bool:
    confirmed = True
    shell = _shells.get(run_id)
    if shell is not None:
        confirmed = await shell.destroy()
    browser = _browsers.get(run_id)
    if browser is not None:
        await browser.stop()
    return confirmed
