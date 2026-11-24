"""应用内只读静态项目预览的接口契约。"""
from typing import Literal, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.models.identity import RelativePath, RootId

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)

StaticPreviewKind = Literal["attachment", "root_file", "root_dir"]


class StaticPreviewMountRequest(BaseModel):
    """创建独立静态预览挂载：支持附件 HTML、工作区/会话单 HTML 文件或静态目录。"""
    kind: StaticPreviewKind
    file_id: Optional[str] = Field(default=None, min_length=1, max_length=128, description="attachment 来源的附件 ID")
    root_id: Optional[RootId] = Field(default=None, description="root_file 或 root_dir 来源的根 ID")
    relative_path: RelativePath = Field(default="", description="根内相对路径；root_dir 为空串时表示根目录")
    entry_path: RelativePath = Field(default="", description="root_dir 的入口相对路径，省略时默认 index.html")

    @model_validator(mode="after")
    def _validate_source(self) -> Self:
        if self.kind == "attachment":
            if not self.file_id:
                raise ValueError("attachment 挂载必须提供 file_id")
            if self.root_id is not None or self.relative_path or self.entry_path:
                raise ValueError("attachment 挂载不得携带 root_id、relative_path 或 entry_path")
        elif self.kind == "root_file":
            if self.file_id is not None or self.entry_path:
                raise ValueError("root_file 挂载不得携带 file_id 或 entry_path")
            if not self.root_id or not self.relative_path:
                raise ValueError("root_file 挂载必须提供 root_id 与 relative_path")
        else:
            if self.file_id is not None:
                raise ValueError("root_dir 挂载不得携带 file_id")
            if not self.root_id:
                raise ValueError("root_dir 挂载必须提供 root_id")
        return self


class StaticPreviewMount(BaseModel):
    """已签发的静态预览挂载。"""
    model_config = _STRICT

    mount_token: str
    kind: StaticPreviewKind
    title: str
    entry_path: str
    preview_url: str
    origin: str
    expires_at: int = Field(description="挂载到期时间（毫秒时间戳）")
    export_zip_path: Optional[str] = Field(default=None, description="仅 root_dir 提供：打包导出 ZIP 的 API 相对路径")


class StaticPreviewDeleteResult(BaseModel):
    model_config = _STRICT

    deleted: bool = True
