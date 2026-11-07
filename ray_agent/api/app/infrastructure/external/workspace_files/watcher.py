"""用 watchfiles 监视工作区文件夹；排除规则与写入临时文件在这里过滤。"""
import asyncio
import os
from typing import AsyncIterator

from watchfiles import Change, awatch

from app.domain.services.file_rules import is_excluded


def _watched(location: str):
    def accept(_: Change, path: str) -> bool:
        relative = os.path.relpath(path, location)
        if relative.startswith(".."):
            return True  # 文件夹自身被移动或替换时路径不在其内，保留给调用方核对
        parts = relative.split(os.sep)
        if any(is_excluded(part, True) for part in parts[:-1]):
            return False
        return not (is_excluded(parts[-1], True) or is_excluded(parts[-1], False))
    return accept


class WatchfilesFolderWatcher:

    def __init__(self, debounce_ms: int, quiet_ms: int) -> None:
        self._debounce_ms, self._quiet_ms = debounce_ms, quiet_ms

    async def watch(self, location: str, stop: asyncio.Event) -> AsyncIterator[set[str]]:
        try:
            async for changes in awatch(location, watch_filter=_watched(location), stop_event=stop,
                                        debounce=self._debounce_ms, rust_timeout=self._quiet_ms,
                                        yield_on_timeout=True, ignore_permission_denied=True):
                yield {path for _, path in changes}
        except FileNotFoundError as error:
            raise OSError(str(error)) from error
