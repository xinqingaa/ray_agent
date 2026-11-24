"""项目预览声明表的数据库仓库实现。"""
from typing import List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.workspace_preview import PreviewKind, WorkspacePreview
from app.domain.repositories.preview_repository import PreviewRepository
from app.infrastructure.models import WorkspacePreviewModel


class DBPreviewRepository(PreviewRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def save(self, preview: WorkspacePreview) -> WorkspacePreview:
        record = await self.db_session.get(WorkspacePreviewModel, preview.id)
        if record is None:
            record = WorkspacePreviewModel.from_domain(preview)
            self.db_session.add(record)
        else:
            record.workspace_id = preview.workspace_id
            record.session_id = preview.session_id
            record.run_id = preview.run_id
            record.name = preview.name
            record.kind = preview.kind
            record.root_id = preview.root_id
            record.relative_path = preview.relative_path
            record.entry_path = preview.entry_path
            record.start_command = preview.start_command
            record.health_path = preview.health_path
            record.updated_at = preview.updated_at
        await self.db_session.flush()
        return record.to_domain()

    async def get(self, preview_id: str) -> Optional[WorkspacePreview]:
        record = await self.db_session.get(WorkspacePreviewModel, preview_id)
        return record.to_domain() if record is not None else None

    async def find_matching(
        self,
        *,
        session_id: str,
        kind: PreviewKind,
        root_id: str,
        relative_path: str,
    ) -> Optional[WorkspacePreview]:
        stmt = (
            select(WorkspacePreviewModel)
            .where(
                WorkspacePreviewModel.session_id == session_id,
                WorkspacePreviewModel.kind == kind,
                WorkspacePreviewModel.root_id == root_id,
                WorkspacePreviewModel.relative_path == relative_path,
            )
            .order_by(WorkspacePreviewModel.updated_at.desc(), WorkspacePreviewModel.created_at.desc())
            .limit(1)
        )
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record is not None else None

    async def list_by_session(self, session_id: str) -> List[WorkspacePreview]:
        stmt = (
            select(WorkspacePreviewModel)
            .where(WorkspacePreviewModel.session_id == session_id)
            .order_by(WorkspacePreviewModel.updated_at.desc(), WorkspacePreviewModel.created_at.desc())
        )
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records]

    async def list_by_workspace(self, workspace_id: str) -> List[WorkspacePreview]:
        stmt = (
            select(WorkspacePreviewModel)
            .where(WorkspacePreviewModel.workspace_id == workspace_id)
            .order_by(WorkspacePreviewModel.updated_at.desc(), WorkspacePreviewModel.created_at.desc())
        )
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records]

    async def list_all(self) -> List[WorkspacePreview]:
        stmt = select(WorkspacePreviewModel).order_by(
            WorkspacePreviewModel.updated_at.desc(), WorkspacePreviewModel.created_at.desc()
        )
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records]

    async def delete(self, preview_id: str) -> bool:
        result = await self.db_session.execute(
            delete(WorkspacePreviewModel).where(WorkspacePreviewModel.id == preview_id)
        )
        await self.db_session.flush()
        return bool(result.rowcount)

    async def delete_by_session(self, session_id: str) -> None:
        await self.db_session.execute(
            delete(WorkspacePreviewModel).where(WorkspacePreviewModel.session_id == session_id)
        )
        await self.db_session.flush()

    async def delete_by_workspace(self, workspace_id: str) -> None:
        await self.db_session.execute(
            delete(WorkspacePreviewModel).where(WorkspacePreviewModel.workspace_id == workspace_id)
        )
        await self.db_session.flush()

    async def delete_all(self) -> None:
        await self.db_session.execute(delete(WorkspacePreviewModel))
        await self.db_session.flush()
