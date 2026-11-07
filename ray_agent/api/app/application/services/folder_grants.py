"""文件夹授权：宿主弹出系统选择器后登记用户选中的路径，界面凭一次性凭证请求打开工作区或更改默认位置。

凭证只在内存里、短期有效、一次使用；核心不接受界面直接提交的桌面绝对路径。
"""
import secrets
import time
from dataclasses import dataclass
from typing import Callable

from app.application.errors.exceptions import BadRequestError, GoneError
from core.config import get_settings


@dataclass(frozen=True)
class FolderGrant:
    grant_id: str
    path: str
    expires_at: float  # epoch 秒


class FolderGrants:
    def __init__(self, ttl_seconds: float, capacity: int, clock: Callable[[], float] = time.time) -> None:
        self._ttl, self._capacity, self._clock = ttl_seconds, capacity, clock
        self._grants: dict[str, FolderGrant] = {}

    def issue(self, path: str) -> FolderGrant:
        now = self._clock()
        self._grants = {key: grant for key, grant in self._grants.items() if grant.expires_at > now}
        if len(self._grants) >= self._capacity:
            oldest = min(self._grants.values(), key=lambda grant: grant.expires_at)
            del self._grants[oldest.grant_id]
        grant = FolderGrant(grant_id=secrets.token_urlsafe(24), path=path, expires_at=now + self._ttl)
        self._grants[grant.grant_id] = grant
        return grant

    def redeem(self, grant_id: str) -> str:
        """取走凭证并返回路径；未知、已使用或过期都不再有效。"""
        grant = self._grants.pop(grant_id, None)
        if grant is None:
            raise GoneError("文件夹授权不存在或已使用，请重新选择文件夹")
        if grant.expires_at <= self._clock():
            raise GoneError("文件夹授权已过期，请重新选择文件夹")
        return grant.path


_grants: FolderGrants | None = None


def folder_grants() -> FolderGrants:
    global _grants
    if _grants is None:
        settings = get_settings()
        _grants = FolderGrants(settings.folder_grant_seconds, settings.folder_grant_capacity)
    return _grants


def validate_grant_path(path: str) -> str:
    """宿主传入的必须是规范的绝对路径。"""
    if not path or "\x00" in path or not path.startswith("/") and not (len(path) > 2 and path[1] == ":"):
        raise BadRequestError("文件夹路径必须是绝对路径")
    return path
