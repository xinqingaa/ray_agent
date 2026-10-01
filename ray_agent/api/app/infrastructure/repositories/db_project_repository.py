"""PostgreSQL 项目实体与目录登记锁。运行互斥另在受理事务锁项目行。"""
from typing import Optional

from sqlalchemy import func, select, update, delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.workspace_project import WorkspaceProject
from app.domain.repositories.project_repository import ProjectRepository
from app.infrastructure.models.project import ProjectModel, ProjectAuditModel, ProjectSnapshotModel, ProjectFileCopyModel


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
        await self.db_session.execute(insert(ProjectModel).values(**self._values(project)))
        return project

    async def save(self, project: WorkspaceProject) -> None:
        values = self._values(project)
        values.pop("id")
        values.pop("created_at")
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

    @staticmethod
    def _values(project):
        values = project.model_dump(mode="python", exclude={"file_operation"})
        values["file_operation"] = project.file_operation.model_dump(mode="json") if project.file_operation else None
        return values

    async def all(self) -> list[WorkspaceProject]:
        records = (await self.db_session.execute(select(ProjectModel).order_by(ProjectModel.id))).scalars().all()
        return [record.to_domain() for record in records]

    async def audit(self, project_id, event_type, payload):
        from datetime import datetime
        # 调用方已经锁项目行，seq 分配与更新提交共用事务。
        seq = (await self.db_session.execute(select(func.coalesce(func.max(ProjectAuditModel.seq), 0)).where(
            ProjectAuditModel.project_id == project_id))).scalar_one() + 1
        await self.db_session.execute(insert(ProjectAuditModel).values(project_id=project_id,
            seq=seq, type=event_type, payload=payload, created_at=datetime.now()))
        return seq

    async def events(self, project_id, after_seq=0, limit=50):
        records = (await self.db_session.execute(select(ProjectAuditModel).where(
            ProjectAuditModel.project_id == project_id, ProjectAuditModel.seq > after_seq
        ).order_by(ProjectAuditModel.seq).limit(limit))).scalars().all()
        return [dict(seq=r.seq, type=r.type, payload=r.payload, created_at=r.created_at.isoformat()) for r in records]

    async def add_snapshot(self, snapshot):
        await self.db_session.execute(insert(ProjectSnapshotModel).values(**snapshot.model_dump(mode='python')))

    async def snapshots(self, project_id):
        from app.domain.models.project_snapshot import ProjectSnapshot
        records = (await self.db_session.execute(select(ProjectSnapshotModel).where(
            ProjectSnapshotModel.project_id == project_id).order_by(
            ProjectSnapshotModel.created_at.desc(), ProjectSnapshotModel.id.desc()))).scalars().all()
        return [ProjectSnapshot.model_validate(r) for r in records]

    async def drop_snapshots(self, project_id, ids):
        if ids:
            await self.db_session.execute(delete(ProjectSnapshotModel).where(
                ProjectSnapshotModel.project_id == project_id, ProjectSnapshotModel.id.in_(ids)))

    async def operation_result(self, project_id, operation_id):
        record = (await self.db_session.execute(select(ProjectAuditModel).where(
            ProjectAuditModel.project_id == project_id,
            ProjectAuditModel.payload['operation_id'].astext == operation_id,
            ProjectAuditModel.type == 'file_operation',
        ).order_by(ProjectAuditModel.seq.desc()).limit(1))).scalar_one_or_none()
        return record.payload if record else None


    async def file_copy(self, project_id, copy_key):
        from app.domain.models.project_file_copy import ProjectFileCopy
        record = (await self.db_session.execute(select(ProjectFileCopyModel).where(
            ProjectFileCopyModel.project_id == project_id, ProjectFileCopyModel.copy_key == copy_key))).scalar_one_or_none()
        return ProjectFileCopy.model_validate(record) if record else None

    async def file_copies(self, project_id, *, run_id=None):
        from app.domain.models.project_file_copy import ProjectFileCopy
        stmt = select(ProjectFileCopyModel).where(ProjectFileCopyModel.project_id == project_id)
        if run_id:
            stmt = stmt.where(ProjectFileCopyModel.run_id == run_id)
        return [ProjectFileCopy.model_validate(record) for record in (await self.db_session.execute(stmt.order_by(ProjectFileCopyModel.created_at))).scalars()]

    async def save_file_copy(self, copy):
        values = copy.model_dump()
        stmt = insert(ProjectFileCopyModel).values(**values)
        await self.db_session.execute(stmt.on_conflict_do_update(index_elements=['project_id', 'copy_key'],
            set_={k:v for k,v in values.items() if k not in ('project_id', 'copy_key')}))


    async def drop_file_copy(self, project_id, copy_key):
        await self.db_session.execute(delete(ProjectFileCopyModel).where(
            ProjectFileCopyModel.project_id == project_id, ProjectFileCopyModel.copy_key == copy_key))
