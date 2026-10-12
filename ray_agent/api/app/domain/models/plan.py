"""任务范围、稳定阶段、执行步骤和可回放的成果记录。"""
import uuid
from enum import Enum
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class Step(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str = ""
    status: ExecutionStatus = ExecutionStatus.PENDING
    kind: Literal["stage", "step"] = "stage"
    parent_id: Optional[str] = None
    schedule: Literal["current", "future"] = "current"
    source_seq: Optional[int] = None
    reason: str = ""
    result: Optional[str] = None
    error: Optional[str] = None
    success: bool = False
    attachments: List[str] = Field(default_factory=list)

    @property
    def done(self) -> bool:
        return self.status in (ExecutionStatus.COMPLETED, ExecutionStatus.CANCELLED)

    @property
    def open(self) -> bool:
        return not self.done and self.schedule == "current"

    @property
    def deferred(self) -> bool:
        return not self.done and self.schedule == "future"


class Artifact(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    path: Optional[str] = None
    delivery: Literal["file", "reply"] = "file"
    required: bool = True
    schedule: Literal["current", "future"] = "current"
    source: Literal["user", "agent"] = "user"
    source_seq: Optional[int] = None
    version: Optional[str] = None
    delivered_version: Optional[str] = None
    file_id: Optional[str] = None
    delivered_file: Optional[dict] = None
    delivery_project: Optional[dict] = None
    state: Literal["pending", "generated", "delivered", "failed"] = "pending"
    error: Optional[str] = None
    final_scope: Optional[str] = None
    final_path: Optional[str] = None
    final_writes: int = 0
    final_attempts: int = 0


class Verification(BaseModel):
    key: str
    artifact_id: str
    condition: str
    version: Optional[str] = None
    call_id: str
    state: Literal["passed", "failed", "executed", "stale"]
    attempts: int = 0
    note: str = ""


class Plan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = ""
    description: str = ""
    goal: str = ""
    source_seq: Optional[int] = None
    scope: str = ""
    language: str = ""
    steps: List[Step] = Field(default_factory=list)
    artifacts: List[Artifact] = Field(default_factory=list)
    verifications: List[Verification] = Field(default_factory=list)
    message: str = ""
    status: ExecutionStatus = ExecutionStatus.PENDING
    error: Optional[str] = None

    @property
    def stages(self) -> List[Step]:
        return [s for s in self.steps if s.kind == "stage"]

    @property
    def done(self) -> bool:
        return bool(self.stages) and all(s.done for s in self.stages)

    def get_next_step(self) -> Optional[Step]:
        return next((s for s in self.steps if s.open and s.status != ExecutionStatus.BLOCKED), None)

    def missing_artifacts(self) -> List[Artifact]:
        return [a for a in self.artifacts if a.required and a.schedule == "current" and a.delivery == "file"
                and (a.state != "delivered" or a.delivered_version != a.version)]
