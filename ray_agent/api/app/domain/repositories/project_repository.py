"""项目实体仓库。锁必须位于调用方 UoW 的事务内。"""
from typing import Optional, Protocol

from app.domain.models.workspace_project import WorkspaceProject


class ProjectRepository(Protocol):
    async def get(self, project_id: str, *, lock: bool = False) -> Optional[WorkspaceProject]:
        ...

    async def create(self, project: WorkspaceProject) -> WorkspaceProject:
        ...

    async def save(self, project: WorkspaceProject) -> None:
        ...

    async def page(self, *, archived: bool = False, offset: int = 0, limit: int = 50) -> tuple[list[WorkspaceProject], int]:
        ...

    async def get_many(self, project_ids: list[str]) -> list[WorkspaceProject]:
        ...

    async def all(self) -> list[WorkspaceProject]:
        ...

    async def audit(self, project_id: str, event_type: str, payload: dict) -> int:
        ...

    async def events(self, project_id: str, after_seq: int = 0, limit: int = 50) -> list[dict]:
        ...

    async def add_snapshot(self, snapshot) -> None:
        ...

    async def snapshots(self, project_id: str) -> list:
        ...

    async def drop_snapshots(self, project_id: str, ids: list[str]) -> None:
        ...

    async def operation_result(self, project_id: str, operation_id: str) -> dict | None:
        ...
