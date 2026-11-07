"""本机执行：supervisor、客户端、ProcessExecutor 实现与 Shell 桥。

导出按需加载：supervisor 以 `python -m` 方式运行本包下的模块，包初始化不能先把它们导入。
"""
from importlib import import_module

_EXPORTS = {
    "SupervisedProcessExecutor": "process_executor",
    "UnknownRootError": "process_executor",
    "SupervisorClient": "supervisor_client",
    "SupervisorError": "supervisor_client",
    "SupervisorUnavailable": "supervisor_client",
    "UnknownProcess": "supervisor_client",
    "LocalShellBridge": "shell_bridge",
    "ensure_supervisor": "supervisor_lifecycle",
    "stop_supervisor": "supervisor_lifecycle",
    "configure_executor": "supervisor_lifecycle",
    "get_executor": "supervisor_lifecycle",
    "shutdown_executor": "supervisor_lifecycle",
    "scrub_env": "env",
    "managed_path": "env",
    "strip_pyinstaller_markers": "env",
    "build_process_env": "env",
    "detect_posix_shell": "env",
}

__all__ = sorted(_EXPORTS)


def __getattr__(name: str):
    module = _EXPORTS.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return getattr(import_module(f".{module}", __name__), name)
