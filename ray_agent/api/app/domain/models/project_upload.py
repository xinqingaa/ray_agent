"""浏览器确认的最终文件集合；服务端仍复核实际字节及当前项目冲突。"""
from pydantic import BaseModel, Field, field_validator
from app.domain.services.project_paths import normalize_relative


class ProjectUploadItem(BaseModel):
    model_config = {'extra': 'forbid'}
    path: str = Field(min_length=1, max_length=4096)
    size: int = Field(ge=0)
    sha256: str = Field(pattern='^[0-9a-f]{64}$')
    overwrite: bool = False

    @field_validator('path')
    @classmethod
    def relative_path(cls, value):
        path = normalize_relative(value)
        if not path:
            raise ValueError('上传路径必须是项目内相对路径')
        return path


class ProjectUploadSelection(BaseModel):
    model_config = {'extra': 'forbid'}
    rule_version: str
    items: list[ProjectUploadItem] = Field(max_length=2000)
    include_optional: list[str] = Field(default_factory=list, max_length=2000)
    inventory: list[str] = Field(default_factory=list, max_length=10000)
    fingerprint: dict = Field(default_factory=dict)
