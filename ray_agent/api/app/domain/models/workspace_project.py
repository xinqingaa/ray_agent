"""长期项目与首次受理的对话设置快照。可用性由应用服务实时核对，不存入实体。"""
import re
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProjectSettings(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str = Field(min_length=1, max_length=160)
    instructions: Optional[str] = Field(default=None, max_length=8000)
    git_author_name: Optional[str] = Field(default=None, max_length=120)
    git_author_email: Optional[str] = Field(default=None, max_length=320)

    @field_validator("name", "git_author_name", "git_author_email", mode="before")
    @classmethod
    def normalize_short_text(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("名称与 Git 身份必须是文字")
        value = value.strip()
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("名称与 Git 身份不能包含换行或控制字符")
        return value or None

    @field_validator("instructions")
    @classmethod
    def validate_instructions(cls, value):
        if value is not None and "\x00" in value:
            raise ValueError("项目说明不能包含 NUL 字符")
        return value if value and value.strip() else None

    @model_validator(mode="after")
    def validate_identity(self):
        if bool(self.git_author_name) != bool(self.git_author_email):
            raise ValueError("Git 姓名与邮箱必须成对设置")
        if self.git_author_email and not re.fullmatch(r"[^@\s]+@[^@\s]+", self.git_author_email):
            raise ValueError("Git 邮箱格式不正确")
        return self


class WorkspaceProject(ProjectSettings):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    path: str = Field(min_length=1, max_length=4096)
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    last_active_at: Optional[datetime] = None


class ProjectTaskSnapshot(ProjectSettings):
    project_id: str
    path: str
    # 初次受理时的只读观察；不是全文件快照，也不用于回滚。
    initial_head: Optional[str] = None
    initial_dirty: Optional[bool] = None
    # 用于识别目录被同路径替换；具体值由部署环境的路径适配层产生。
    directory_identity: Optional[str] = None

    def git_environment(self) -> dict[str, str]:
        if not self.git_author_name or not self.git_author_email:
            return {}
        return {
            "GIT_AUTHOR_NAME": self.git_author_name,
            "GIT_AUTHOR_EMAIL": self.git_author_email,
            "GIT_COMMITTER_NAME": self.git_author_name,
            "GIT_COMMITTER_EMAIL": self.git_author_email,
        }
