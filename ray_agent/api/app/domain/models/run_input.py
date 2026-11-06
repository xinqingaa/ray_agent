"""持久输入与受理记录。

用户消息受理时，消息事件、运行（新建或续接）与一条待消费输入在同一事务提交；输入进入模型历史时，消费状态与
对应的上下文事件同事务提交。所属运行进入终态后仍未消费的输入保持可见，由用户明确重新发起，不自动执行。
"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from .clock import utc_now


class RunInputStatus(str, Enum):
    PENDING = "pending"
    CONSUMED = "consumed"


class RunInput(BaseModel):
    id: Optional[int] = None
    session_id: str
    run_id: str
    message_seq: int  # 携带正文的用户消息事件
    request_id: Optional[str] = None
    status: RunInputStatus = RunInputStatus.PENDING
    consumed_seq: Optional[int] = None  # 记录它进入模型历史的上下文事件
    created_at: datetime = Field(default_factory=utc_now)
    consumed_at: Optional[datetime] = None


class AcceptedRequest(BaseModel):
    """请求身份的受理结果：同身份同内容返回原结果，内容不同返回冲突。"""
    request_id: str
    session_id: str
    kind: str
    digest: str
    result: Dict[str, Any]
    created_at: datetime = Field(default_factory=utc_now)
