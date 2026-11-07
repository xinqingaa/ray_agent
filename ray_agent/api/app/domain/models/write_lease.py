"""工作区文件夹的写入租约：覆盖整个文件夹，每个工作区至多一个未释放的租约。

租约持久保存，记录当前写入者是谁（会话、运行、操作）、属于哪次核心启动、写入者类型与所处阶段。
释放即删除记录；只有 `blocked` 与 `settling` 说明写入者尚未确认静止。
"""
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.domain.models.clock import utc_now


class LeaseState(StrEnum):
    PREPARING = "preparing"  # 已取得租约，正在核对与备份，尚未发布
    HELD = "held"  # 正在发布
    SETTLING = "settling"  # 已请求停止，等待写入者确认退出
    BLOCKED = "blocked"  # 期限内未能确认写入者静止，需要用户重试收尾


class WriterKind(StrEnum):
    CORE_TOOL = "core_tool"  # 核心进程内的文件工具、上传与撤销：随核心进程结束而静止
    PROCESS = "process"  # 外部进程写入者（Shell 等）：核心重启后不能凭记录断定已静止


class WriteLease(BaseModel):
    id: str
    workspace_id: str
    owner_session_id: str = Field(description="持有者所在会话；上传等不属于会话的写入为空串")
    owner_run_id: str | None = None
    operation: str | None = Field(default=None, description="同一运行内区分长操作，例如一次撤销")
    writer_kind: WriterKind = WriterKind.CORE_TOOL
    instance_id: str
    state: LeaseState = LeaseState.PREPARING
    reason: str = ""
    holds: int = Field(default=1, ge=1, description="同一持有者的重入次数")
    acquired_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    def owned_by(self, session_id: str, run_id: str | None, operation: str | None) -> bool:
        return (self.owner_session_id, self.owner_run_id, self.operation) == (session_id, run_id, operation)
