"""工作区文件夹的外部变更通知：推给订阅者的事件。时间无关，订阅者收到后重新读取需要的目录即可。"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceChangeEvent(BaseModel):
    """kind=ready 在订阅建立时给出当前可用性；changed 带变化的相对路径，refresh 为真表示变化太多或来源不明，
    需要整体刷新；availability 在文件夹失联或恢复时给出。应用自己的写入同样会触发 changed。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal["ready", "changed", "availability"]
    workspace_id: str
    available: bool
    paths: list[str] = Field(default_factory=list)
    refresh: bool = False
    reason: str | None = Field(default=None, description="不可用时的原因")
