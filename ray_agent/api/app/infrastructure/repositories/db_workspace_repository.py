"""工作区的 SQLite 实现。版本核对在一条 UPDATE 里完成；默认位置存在 app_config 的 workspace 行。"""
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.clock import utc_now
from app.domain.models.workspace import Workspace, WorkspaceStatus
from app.domain.repositories.workspace_repository import WorkspaceRepository
from app.infrastructure.models import AppConfigModel, WorkspaceModel

CONFIG_KEY = "workspace"  # 不在 app_config 的分区清单内，分区读写不会触及


class DBWorkspaceRepository(WorkspaceRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, workspace: Workspace) -> None:
        self.db_session.add(WorkspaceModel.from_domain(workspace))
        await self.db_session.flush()

    async def get(self, workspace_id: str) -> Optional[Workspace]:
        model = await self.db_session.get(WorkspaceModel, workspace_id, populate_existing=True)
        return model.to_domain() if model is not None else None

    async def list(self) -> list[Workspace]:
        rows = (await self.db_session.execute(
            select(WorkspaceModel).where(WorkspaceModel.status != WorkspaceStatus.DELETING.value)
            .order_by(WorkspaceModel.created_at, WorkspaceModel.id))).scalars().all()
        return [row.to_domain() for row in rows]

    async def update(self, workspace_id: str, expected_version: int, **values) -> Optional[Workspace]:
        if "status" in values:
            values["status"] = WorkspaceStatus(values["status"]).value
        result = await self.db_session.execute(
            update(WorkspaceModel).where(WorkspaceModel.id == workspace_id, WorkspaceModel.version == expected_version)
            .values(**values, version=expected_version + 1, updated_at=utc_now())
            .execution_options(synchronize_session=False))
        if result.rowcount == 0:
            return None
        return await self.get(workspace_id)

    async def remove(self, workspace_id: str) -> None:
        await self.db_session.execute(delete(WorkspaceModel).where(WorkspaceModel.id == workspace_id))

    async def default_location(self) -> Optional[str]:
        row = await self.db_session.get(AppConfigModel, CONFIG_KEY, populate_existing=True)
        return (row.data or {}).get("default_location") if row is not None else None

    async def set_default_location(self, location: str) -> None:
        row = await self.db_session.get(AppConfigModel, CONFIG_KEY)
        if row is None:
            self.db_session.add(AppConfigModel(key=CONFIG_KEY, data={"default_location": location}, version=1))
        else:
            row.data = {"default_location": location}
            row.version += 1
        await self.db_session.flush()
