"""项目实体仓库。锁必须位于调用方 UoW 的事务内。"""
from typing import Optional, Protocol

from app.domain.models.workspace_project import WorkspaceProject


class ProjectRepository(Protocol):
    async def lock_registry(self) -> None:
        """登记目录时串行核对重叠路径；不是 Agent 执行锁。"""
        ...

    async def get(self, project_id: str, *, lock: bool = False) -> Optional[WorkspaceProject]:
        ...

    async def get_by_path(self, path: str) -> Optional[WorkspaceProject]:
        ...

    async def overlapping(self, path: str) -> Optional[WorkspaceProject]:
        """返回双向嵌套的项目，包含归档实体，不包含相同路径。"""
        ...

    async def create_or_get(self, project: WorkspaceProject) -> WorkspaceProject:
        ...

    async def save(self, project: WorkspaceProject) -> None:
        ...

    async def page(self, *, archived: bool = False, offset: int = 0, limit: int = 50) -> tuple[list[WorkspaceProject], int]:
        ...

    async def get_many(self, project_ids: list[str]) -> list[WorkspaceProject]:
        ...
