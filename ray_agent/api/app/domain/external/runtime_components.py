"""受管组件端口：浏览器、Embedding、OCR 与工具运行时按清单固定版本、平台与校验和，安装是持久长操作。"""
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Protocol

from pydantic import BaseModel, Field, StringConstraints

from app.domain.models.error import ErrorInfo
from app.domain.models.identity import ContentHash, OperationId, RequestId

type ComponentId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,63}$"),
                             Field(description="组件身份，如浏览器或某个 Embedding 模型")]


class ComponentState(StrEnum):
    NOT_INSTALLED = "not_installed"
    FETCHING = "fetching"
    VERIFYING = "verifying"
    AVAILABLE = "available"  # 已通过哈希与实际可启动检查
    FAILED = "failed"
    CANCELLED = "cancelled"


class ComponentManifestEntry(BaseModel):
    component_id: ComponentId
    version: str
    platform: str  # 系统与架构，如 macos-arm64
    sha256: ContentHash
    size: int = Field(ge=0)
    source_url: str
    license: str


class ComponentStatus(BaseModel):
    component_id: ComponentId
    state: ComponentState
    version: str | None = None  # 当前可用版本；新版本完整发布前旧版本继续可用
    operation_id: OperationId | None = None  # 进行中或最近一次安装操作
    error: ErrorInfo | None = None


class RuntimeComponents(Protocol):
    async def list_components(self) -> list[ComponentStatus]:
        ...

    async def status(self, component_id: ComponentId) -> ComponentStatus:
        ...

    async def install(self, component_id: ComponentId, request_id: RequestId) -> OperationId:
        """同一 request_id 重复提交返回同一操作。"""
        ...

    async def cancel(self, operation_id: OperationId) -> None:
        ...

    async def locate(self, component_id: ComponentId) -> Path:
        """可用组件的安装位置；不可用时抛出带原因的错误。"""
        ...
