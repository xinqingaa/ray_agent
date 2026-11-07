"""工作区：一个绑定本地文件夹的长期工作范围。

文件夹绑定记录在可访问根上（规范路径、文件系统身份与可用状态）；文件夹中的身份标记只保存本机安装身份与
工作区身份的对应，不含名称、会话或其他内容。
"""
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.clock import utc_now
from app.domain.models.identity import InstallId, RootId, RootRef, WorkspaceId

MARKER_DIRECTORY = ".rayagent"
MARKER_FILE = "workspace.json"
MARKER_FORMAT = 1
WORKSPACE_NAME_MAX_LENGTH = 80


class WorkspaceStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"  # 只读：不再新建会话，也不写入文件夹
    DELETING = "deleting"  # 清理任务进行中，不出现在列表里


class FolderStatus(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"  # 路径不存在或文件系统身份不符；会话仍可用，文件工具报告不可用


class Workspace(BaseModel):
    id: WorkspaceId = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    status: WorkspaceStatus = WorkspaceStatus.ACTIVE
    folder_root_id: RootId | None = None
    version: int = Field(default=1, ge=1, description="并发修改的核对版本，每次变更递增")
    settings: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class RootRecord(BaseModel):
    """登记的可访问根及其位置。工作区文件夹根另带登记时的文件系统身份与最近一次核对的状态。"""
    ref: RootRef
    location: str = Field(description="工作区文件夹为规范绝对路径，会话工作目录为相对数据根的位置")
    dev: int | None = None
    ino: int | None = None
    status: FolderStatus = FolderStatus.AVAILABLE
    marker_writable: bool = True  # 身份标记写入失败时为假：移动文件夹后需要手动重新定位
    checked_at: datetime | None = None


class MarkerEntry(BaseModel):
    model_config = ConfigDict(extra="allow")  # 其他安装写入的未知字段重写时原样保留

    install_id: InstallId
    workspace_id: WorkspaceId


class MarkerFile(BaseModel):
    model_config = ConfigDict(extra="allow")

    format: int = MARKER_FORMAT
    entries: list[MarkerEntry] = Field(default_factory=list)

    def entry_for(self, install_id: str) -> MarkerEntry | None:
        return next((entry for entry in self.entries if entry.install_id == install_id), None)


class FolderInspection(BaseModel):
    """打开前对文件夹的只读检查：规范路径、文件系统身份与标记内容（标记缺失或无法解析为空）。"""
    path: str
    dev: int
    ino: int
    marker: MarkerFile | None = None
    marker_unreadable: bool = False


class ConflictResolution(StrEnum):
    AS_NEW = "as_new"  # 在此文件夹重写本机条目，成为新工作区
    REBIND = "rebind"  # 改绑到这里，原文件夹解除绑定


class MarkerConflict(BaseModel):
    """复制出的文件夹：标记指向一个仍绑定在别处的已知工作区。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    conflict_id: str
    path: str
    workspace_id: WorkspaceId
    workspace_name: str
    bound_path: str
    options: list[Literal["as_new", "rebind"]] = Field(default_factory=lambda: ["as_new", "rebind"])
