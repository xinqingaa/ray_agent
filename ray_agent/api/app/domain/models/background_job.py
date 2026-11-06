"""持久后台任务：长操作契约加上执行所需的载荷、实例所有者、对象版本与幂等键。

执行端写回进度与结果时同时核对代次与所有者，重试或重启接管后迟到的结果不会写回。
"""
from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import Field

from .operation import Operation


class BackgroundJob(Operation):
    payload: Dict[str, Any] = Field(default_factory=dict)
    owner_instance: Optional[str] = None
    object_version: Optional[str] = None
    idempotency_key: Optional[str] = None
    started_at: Optional[datetime] = None
