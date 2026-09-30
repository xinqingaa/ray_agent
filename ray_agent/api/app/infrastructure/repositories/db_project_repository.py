"""PostgreSQL 项目实体与目录登记锁。运行互斥另在受理事务锁项目行。"""
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.workspace_project import WorkspaceProject
from app.domain.repositories.project_repository import ProjectRepository
from app.infrastructure.models.project import ProjectModel


class DBProjectRepository(ProjectRepository):
    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session

    async def get(self, project_id: str, *, lock: bool = False) -> Optional[WorkspaceProject]:
        stmt = select(ProjectModel).where(ProjectModel.id == project_id)
        if lock:
            stmt = stmt.with_for_update()
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def create(self, project: WorkspaceProject) -> WorkspaceProject:
        await self.db_session.execute(insert(ProjectModel).values(**project.model_dump(mode="python")))
        return project

    async def save(self, project: WorkspaceProject) -> None:
        values = project.model_dump(mode="python", exclude={"id", "created_at"})
        result = await self.db_session.execute(update(ProjectModel).where(ProjectModel.id == project.id).values(**values))
        if result.rowcount == 0:
            raise ValueError("项目不存在")

    async def page(self, *, archived: bool = False, offset: int = 0, limit: int = 50) -> tuple[list[WorkspaceProject], int]:
        criterion = ProjectModel.archived_at.is_not(None) if archived else ProjectModel.archived_at.is_(None)
        total = (await self.db_session.execute(select(func.count()).select_from(ProjectModel).where(criterion))).scalar_one()
        stmt = select(ProjectModel).where(criterion).order_by(ProjectModel.last_active_at.desc().nullslast(), ProjectModel.created_at.desc(), ProjectModel.id).offset(offset).limit(limit)
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records], total

    async def get_many(self, project_ids: list[str]) -> list[WorkspaceProject]:
        if not project_ids:
            return []
        records = (await self.db_session.execute(select(ProjectModel).where(ProjectModel.id.in_(project_ids)))).scalars().all()
        return [record.to_domain() for record in records]
