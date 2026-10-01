"""仅完整发布后登记的项目内容快照。清单与对象位于项目私有快照目录。"""
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class ProjectSnapshot(BaseModel):
    model_config = {'from_attributes': True}
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str
    source: Literal['run', 'upload', 'restore']
    run_id: str | None = None
    session_id: str | None = None
    total_bytes: int = 0
    manifest_sha256: str
    created_at: datetime = Field(default_factory=datetime.now)
