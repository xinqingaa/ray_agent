"""运行背景清单：新运行受理时实际装配的工作方式、常驻记忆与初始召回来源。"""
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from .clock import utc_now
from .identity import InstructionVersion, MemoryId, MemoryVersion, SessionId, WorkspaceId
from .retrieval import SearchHit


class ResidentMemoryRef(BaseModel):
    memory_id: MemoryId
    version: MemoryVersion
    content: str
    memory_type: str
    certainty: str
    pinned: bool = False


class ContextOmission(BaseModel):
    kind: str  # instruction / memory / retrieval
    reason: str
    source_id: Optional[str] = None


class RunContextManifest(BaseModel):
    run_id: str
    session_id: SessionId
    workspace_id: Optional[WorkspaceId] = None
    instruction_version: Optional[InstructionVersion] = None
    instruction_body: Optional[str] = None
    resident_memories: list[ResidentMemoryRef] = Field(default_factory=list)
    retrieval_hits: list[SearchHit] = Field(default_factory=list)
    omissions: list[ContextOmission] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)

    def as_project_prompt(self) -> str:
        """拼成可注入的长期背景段；各来源带可区分标记。"""
        parts: list[str] = []
        if self.instruction_body:
            parts.append(
                f"<working_style version=\"{self.instruction_version or 0}\">\n"
                f"{self.instruction_body.strip()}\n</working_style>"
            )
        if self.resident_memories:
            lines = []
            for item in self.resident_memories:
                pin = " pinned" if item.pinned else ""
                lines.append(
                    f"- [{item.memory_type}/{item.certainty}{pin} id={item.memory_id} v{item.version}] "
                    f"{item.content}"
                )
            parts.append("<resident_memory>\n" + "\n".join(lines) + "\n</resident_memory>")
        if self.retrieval_hits:
            lines = []
            for hit in self.retrieval_hits:
                stale = " stale" if hit.stale else ""
                lines.append(
                    f"- [{hit.source_type.value}{stale} id={hit.source_id} v{hit.source_version}] "
                    f"{hit.snippet}"
                )
            parts.append("<retrieved_context>\n" + "\n".join(lines) + "\n</retrieved_context>")
        return "\n\n".join(parts)

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
