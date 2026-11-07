"""工作区记忆与工作方式相关仓库协议。"""
from __future__ import annotations  # 仓库有名为 list 的方法，类体内的 list[...] 注解不能在定义时求值

from abc import ABC, abstractmethod
from typing import Optional, Sequence

from app.domain.models.run_context import RunContextManifest
from app.domain.models.session_summary_record import SessionSummaryRecord
from app.domain.models.working_style import InstructionProposal, InstructionVersionRecord, WorkingStyleTemplate
from app.domain.models.workspace_memory import (
    ExtractionJob,
    MemoryChange,
    MemoryEntry,
    MemorySource,
    MemoryStatus,
    MemorySuppression,
)


class InstructionRepository(ABC):
    @abstractmethod
    async def add_version(self, record: InstructionVersionRecord) -> None: ...

    @abstractmethod
    async def get_version(self, workspace_id: str, version: int) -> Optional[InstructionVersionRecord]: ...

    @abstractmethod
    async def latest(self, workspace_id: str) -> Optional[InstructionVersionRecord]: ...

    @abstractmethod
    async def add_proposal(self, proposal: InstructionProposal) -> None: ...

    @abstractmethod
    async def get_proposal(self, proposal_id: str) -> Optional[InstructionProposal]: ...

    @abstractmethod
    async def list_proposals(self, workspace_id: str, *, status: Optional[str] = None) -> list[InstructionProposal]: ...

    @abstractmethod
    async def save_proposal(self, proposal: InstructionProposal) -> None: ...

    @abstractmethod
    async def add_template(self, template: WorkingStyleTemplate) -> None: ...

    @abstractmethod
    async def get_template(self, template_id: str) -> Optional[WorkingStyleTemplate]: ...

    @abstractmethod
    async def list_templates(self) -> list[WorkingStyleTemplate]: ...

    @abstractmethod
    async def save_template(self, template: WorkingStyleTemplate) -> None: ...

    @abstractmethod
    async def remove_template(self, template_id: str) -> None: ...

    @abstractmethod
    async def delete_workspace(self, workspace_id: str) -> None: ...


class MemoryRepository(ABC):
    @abstractmethod
    async def add(self, entry: MemoryEntry) -> None: ...

    @abstractmethod
    async def get(self, memory_id: str) -> Optional[MemoryEntry]: ...

    @abstractmethod
    async def save(self, entry: MemoryEntry) -> None: ...

    @abstractmethod
    async def list(
            self, workspace_id: str, *, statuses: Optional[Sequence[MemoryStatus]] = None,
            pinned_only: bool = False,
    ) -> list[MemoryEntry]: ...

    @abstractmethod
    async def add_source(self, source: MemorySource) -> None: ...

    @abstractmethod
    async def list_sources(self, memory_id: str) -> list[MemorySource]: ...

    @abstractmethod
    async def add_change(self, change: MemoryChange) -> None: ...

    @abstractmethod
    async def list_changes(self, memory_id: str) -> list[MemoryChange]: ...

    @abstractmethod
    async def add_suppression(self, item: MemorySuppression) -> None: ...

    @abstractmethod
    async def is_suppressed(
            self, workspace_id: str, session_id: str, source_seq_end: int, fingerprint: str,
    ) -> bool: ...

    @abstractmethod
    async def clear_suppressions(self, workspace_id: str, session_id: str, fingerprint: str) -> None: ...

    @abstractmethod
    async def add_extraction(self, job: ExtractionJob) -> None: ...

    @abstractmethod
    async def get_extraction(self, extraction_id: str) -> Optional[ExtractionJob]: ...

    @abstractmethod
    async def get_extraction_by_operation(self, operation_id: str) -> Optional[ExtractionJob]: ...

    @abstractmethod
    async def save_extraction(self, job: ExtractionJob) -> None: ...

    @abstractmethod
    async def next_extraction_generation(self, session_id: str) -> int: ...

    @abstractmethod
    async def delete_workspace(self, workspace_id: str) -> None: ...


class SummaryRepository(ABC):
    @abstractmethod
    async def get(self, session_id: str) -> Optional[SessionSummaryRecord]: ...

    @abstractmethod
    async def save(self, record: SessionSummaryRecord) -> None: ...

    @abstractmethod
    async def list_workspace(self, workspace_id: str, *, limit: int = 50) -> list[SessionSummaryRecord]: ...

    @abstractmethod
    async def delete(self, session_id: str) -> None: ...

    @abstractmethod
    async def delete_workspace(self, workspace_id: str) -> None: ...


class RunContextRepository(ABC):
    @abstractmethod
    async def save(self, manifest: RunContextManifest) -> None: ...

    @abstractmethod
    async def get(self, run_id: str) -> Optional[RunContextManifest]: ...

    @abstractmethod
    async def get_for_session(self, session_id: str, *, limit: int = 20) -> list[RunContextManifest]: ...

    @abstractmethod
    async def delete_workspace(self, workspace_id: str) -> None: ...
