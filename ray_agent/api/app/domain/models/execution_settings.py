"""本机执行开关：工作区会话看工作区设置，独立对话看应用级开关（默认关闭）。"""
from typing import Any, Mapping

# 工作区 settings 字典里的键；缺省或非布尔时视为未启用
WORKSPACE_EXECUTION_KEY = "local_execution_enabled"


def workspace_execution_enabled(settings: Mapping[str, Any] | None) -> bool:
    if not settings:
        return False
    value = settings.get(WORKSPACE_EXECUTION_KEY)
    return value is True


def with_workspace_execution(settings: dict[str, Any] | None, enabled: bool) -> dict[str, Any]:
    next_settings = dict(settings or {})
    next_settings[WORKSPACE_EXECUTION_KEY] = bool(enabled)
    return next_settings
