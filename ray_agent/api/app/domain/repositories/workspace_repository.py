"""工作区登记：版本核对更新；默认工作区位置是应用配置。"""
from typing import Optional, Protocol

from app.domain.models.workspace import Workspace


class WorkspaceRepository(Protocol):

    async def add(self, workspace: Workspace) -> None:
        ...

    async def get(self, workspace_id: str) -> Optional[Workspace]:
        ...

    async def list(self) -> list[Workspace]:
        """不含删除中的工作区，按创建时间。"""
        ...

    async def update(self, workspace_id: str, expected_version: int, **values) -> Optional[Workspace]:
        """版本相符才更新并递增版本，返回新值；版本不符或不存在返回空。"""
        ...

    async def remove(self, workspace_id: str) -> None:
        ...

    async def default_location(self) -> Optional[str]:
        ...

    async def set_default_location(self, location: str) -> None:
        ...
