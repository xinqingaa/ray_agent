"""工作区文件夹里的文件变更记录与写前备份对象。

每次经写入口的覆盖、新建或删除都记一行：写前对象保存被覆盖或删除的原字节，新建为空；写后版本是发布后的
大小、修改时间与内容哈希。同一运行对同一文件的多次写入保留多行，按顺序折叠即得「运行前版本」与「运行最后写入版本」。
"""
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.domain.models.clock import utc_now


class ChangeOperation(StrEnum):
    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"


class ChangeSource(StrEnum):
    TOOL = "tool"
    UPLOAD = "upload"
    UNDO = "undo"


class WorkspaceObject(BaseModel):
    """归属某个工作区的应用内容对象：写前备份与撤销前备份。同哈希在工作区内只保存一份，不跨工作区。"""
    id: str
    workspace_id: str
    sha256: str
    size: int = Field(ge=0)
    key: str = Field(description="数据根内容对象位置")
    created_at: datetime = Field(default_factory=utc_now)


class VersionStamp(BaseModel):
    size: int = Field(ge=0)
    modified_ns: int
    sha256: str | None = None


class FileChange(BaseModel):
    id: int | None = None
    workspace_id: str
    session_id: str = ""
    run_id: str | None = None
    tool_call_id: str | None = None
    root_id: str
    relative_path: str
    operation: ChangeOperation
    source: ChangeSource = ChangeSource.TOOL
    undo_of_run_id: str | None = Field(default=None, description="撤销产生的变更记录被撤销的运行")
    before_object_id: str | None = None
    after: VersionStamp | None = Field(default=None, description="删除时为空")
    created_at: datetime = Field(default_factory=utc_now)


class RunChangeRow(BaseModel):
    """某个运行在工作区里有变更记录的汇总行。"""
    run_id: str
    session_id: str
    changes: int
    first_at: datetime
    last_at: datetime
    undo_of_run_id: str | None = Field(default=None, description="这是一次撤销操作：被撤销的运行")
