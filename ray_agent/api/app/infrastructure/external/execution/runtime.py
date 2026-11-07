"""本机执行运行时：supervisor、ProcessExecutor、组件与浏览器会话的进程内装配。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from app.domain.external.browser_session import BrowserProfile
from app.domain.external.process_executor import ProcessOwner
from app.domain.models.capability import UnavailableReason
from app.domain.services.file_scope import FileScope
from app.infrastructure.external.browser.local_session import LocalBrowserSession
from app.infrastructure.external.components.local_components import BROWSER_ID, LocalRuntimeComponents
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import (
    configure_executor, ensure_supervisor, get_executor, ping, socket_path_for,
)
from core.paths import data_root

logger = logging.getLogger(__name__)

_components: LocalRuntimeComponents | None = None
_on_available = None


def runtime_bin_dirs() -> list[Path]:
    """受管运行时 bin：数据根 runtimes/*/bin；缺失时 PATH 仅含允许的系统目录。"""
    root = data_root().runtimes
    found: list[Path] = []
    if not root.is_dir():
        return found
    for child in sorted(root.iterdir()):
        candidate = child / "bin"
        if candidate.is_dir():
            found.append(candidate)
    return found


def set_components_callback(callback) -> None:
    global _on_available, _components
    _on_available = callback
    if _components is not None:
        _components._on_available = callback  # noqa: SLF001


def get_components() -> LocalRuntimeComponents:
    global _components
    if _components is None:
        _components = LocalRuntimeComponents(data_root().components, on_available=_on_available)
    return _components


async def get_process_executor() -> SupervisedProcessExecutor:
    existing = get_executor()
    if existing is not None:
        sock = socket_path_for(data_root().root)
        if await ping(sock) is not None:
            return existing
    sock = await ensure_supervisor(data_root().root, runtime_bin_dirs())
    executor = SupervisedProcessExecutor(SupervisorClient(sock), {})
    configure_executor(executor)
    return executor


async def command_available() -> tuple[bool, str]:
    try:
        await get_process_executor()
        return True, "本机执行 supervisor 可用"
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
        on_session=None,
) -> LocalShellBridge:
    executor = await get_process_executor()
    return LocalShellBridge(
        executor, files=files, session_id=session_id, run_id=run_id, on_session=on_session)


async def open_browser_session(
        *,
        workspace_id: str | None,
        session_id: str | None,
        download_dir: Path | None = None,
) -> LocalBrowserSession:
    profile = BrowserProfile(workspace_id=workspace_id, session_id=session_id if workspace_id is None else None)
    session = LocalBrowserSession(
        get_components(), data_root().browser_profiles, download_dir=download_dir)
    await session.start(profile)
    return session


async def register_external_pid(pid: int, owner: ProcessOwner) -> Optional[str]:
    """登记核心已拉起的外部进程（如 MCP stdio），失败只记日志不阻断业务。"""
    try:
        executor = await get_process_executor()
        status = await executor.register_external(pid, owner)
        return status.process_id
    except Exception:
        logger.exception("登记外部进程失败 pid=%s", pid)
        return None
