"""项目文件操作的持久所有权；运行终态与环境静止分别记录。"""
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class ProjectOperation(BaseModel):
    operation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: Literal['settling', 'upload', 'snapshot', 'restore', 'cleanup']
    state: Literal['running', 'failed'] = 'running'
    run_id: str | None = None
    session_id: str | None = None
    phase: str = 'preparing'
    target_snapshot_id: str | None = None
    before_snapshot_id: str | None = None
    started_at: datetime = Field(default_factory=datetime.now)
    last_active_at: datetime = Field(default_factory=datetime.now)
    error: str | None = None
    results: dict = Field(default_factory=dict)
