"""应用内项目预览（静态站点与轻量受管服务）的接口契约。"""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.identity import PreviewId, RelativePath, RootId, RunId, SessionId, WorkspaceId
from app.domain.models.workspace_preview import PreviewKind, PreviewRuntimeState

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class ManagedPreviewView(BaseModel):
    """项目预览卡片与控制视图。"""
    model_config = _STRICT

    id: PreviewId
    workspace_id: Optional[WorkspaceId] = None
    session_id: SessionId
    run_id: Optional[RunId] = None
    name: str
    kind: PreviewKind
    root_id: RootId
    relative_path: RelativePath = ""
    entry_path: RelativePath = ""
    start_command: Optional[str] = None
    health_path: str = "/"
    state: PreviewRuntimeState
    port: Optional[int] = None
    preview_url: Optional[str] = None
    error: Optional[str] = None
    exit_code: Optional[int] = None
    started_at: Optional[int] = Field(default=None, description="最近启动时间（毫秒时间戳）")
    created_at: int = Field(description="创建时间（毫秒时间戳）")
    updated_at: int = Field(description="更新时间（毫秒时间戳）")


class ManagedPreviewListResponse(BaseModel):
    model_config = _STRICT

    previews: List[ManagedPreviewView] = Field(default_factory=list)


class ManagedPreviewLogsResponse(BaseModel):
    model_config = _STRICT

    preview_id: PreviewId
    state: PreviewRuntimeState
    text: str
    next_offset: int = Field(ge=0)
    truncated: bool = False


class ManagedPreviewDeleteResponse(BaseModel):
    model_config = _STRICT

    deleted: bool = True
