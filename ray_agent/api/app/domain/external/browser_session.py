"""自动化浏览器会话端口：管理浏览器实例与资料目录的生命周期；页面操作沿用 Browser 协议。

每个工作区一个资料目录，独立对话各用自己的目录，不接管用户默认浏览器，不跨工作区共享登录态。
"""
from enum import StrEnum
from typing import Protocol, Self

from pydantic import BaseModel, model_validator

from app.domain.external.browser import Browser
from app.domain.models.identity import SessionId, WorkspaceId


class BrowserProfile(BaseModel):
    workspace_id: WorkspaceId | None = None
    session_id: SessionId | None = None

    @model_validator(mode="after")
    def _single_owner(self) -> Self:
        if (self.workspace_id is None) == (self.session_id is None):
            raise ValueError("浏览器资料目录属于一个工作区或一个独立对话")
        return self


class BrowserSessionState(StrEnum):
    STARTING = "starting"
    READY = "ready"
    STOPPED = "stopped"
    FAILED = "failed"


class BrowserSessionInfo(BaseModel):
    profile: BrowserProfile
    state: BrowserSessionState
    headless: bool = True
    browser_version: str | None = None


class BrowserSession(Protocol):
    async def start(self, profile: BrowserProfile) -> BrowserSessionInfo:
        """按需启动；浏览器组件缺失时由组件端口报告，不在这里安装。"""
        ...

    async def info(self) -> BrowserSessionInfo:
        ...

    async def browser(self) -> Browser:
        ...

    async def stop(self) -> None:
        ...
