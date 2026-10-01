from datetime import datetime
from pydantic import BaseModel, Field


class ProjectFileCopy(BaseModel):
    model_config = {'from_attributes': True}
    project_id: str
    copy_key: str
    kind: str = 'attachment'
    attachment_id: str
    session_id: str
    run_id: str
    resolved_path: str | None = None
    source_path: str | None = None
    tool_call_id: str | None = None
    message_seq: int | None = None
    path: str | None = None
    sha256: str
    size: int
    state: str = 'pending'
    error: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)
