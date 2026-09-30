"""长期项目与首次受理的对话设置快照。可用性由应用服务实时核对，不存入实体。"""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectSettings(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str = Field(min_length=1, max_length=160)
    instructions: Optional[str] = Field(default=None, max_length=8000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_short_text(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("名称必须是文字")
        value = value.strip()
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("名称不能包含换行或控制字符")
        return value or None

    @field_validator("instructions")
    @classmethod
    def validate_instructions(cls, value):
        if value is not None and "\x00" in value:
            raise ValueError("项目说明不能包含 NUL 字符")
        return value if value and value.strip() else None


class WorkspaceProject(ProjectSettings):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    last_active_at: Optional[datetime] = None


class ProjectTaskSnapshot(ProjectSettings):
    project_id: str
