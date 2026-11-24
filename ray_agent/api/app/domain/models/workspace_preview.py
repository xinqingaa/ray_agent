"""应用内项目预览的持久化声明模型（只存可重复拉起的静态声明，不保存假运行态）。"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.domain.models.clock import utc_now
from app.domain.models.identity import PreviewId, RelativePath, RootId, RunId, SessionId, WorkspaceId

PreviewKind = Literal["static", "service"]
PreviewRuntimeState = Literal["ready", "stopped", "starting", "running", "failed"]

PREVIEW_NAME_MAX_CHARS = 80
PREVIEW_COMMAND_MAX_CHARS = 1000
PREVIEW_HEALTH_PATH_MAX_CHARS = 512


class WorkspacePreview(BaseModel):
    """已登记的可运行/可重开项目预览配置。"""
    id: PreviewId = Field(default_factory=lambda: uuid.uuid4().hex)
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
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
