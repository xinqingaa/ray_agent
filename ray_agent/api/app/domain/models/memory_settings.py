"""工作区记忆相关设置键；与本机执行开关同模式，存在 workspaces.settings JSON。"""
from typing import Any, Mapping

AUTO_MEMORY_KEY = "auto_memory_enabled"  # 缺省为开


def auto_memory_enabled(settings: Mapping[str, Any] | None) -> bool:
    if not settings:
        return True
    value = settings.get(AUTO_MEMORY_KEY)
    if value is None:
        return True
    return value is True


def with_auto_memory(settings: dict[str, Any] | None, enabled: bool) -> dict[str, Any]:
    next_settings = dict(settings or {})
    next_settings[AUTO_MEMORY_KEY] = bool(enabled)
    return next_settings
