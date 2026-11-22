"""文件变更记录与工作区备份对象的 SQLite 实现。"""
from typing import Optional

from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.file_change import ChangeOperation, ChangeSource, EntryKind, FileChange, RunChangeRow, WorkspaceObject
from app.domain.repositories.file_change_repository import FileChangeRepository
from app.infrastructure.models import FileChangeModel, FileModel, WorkspaceObjectModel


class DBFileChangeRepository(FileChangeRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, change: FileChange) -> FileChange:
        model = FileChangeModel.from_domain(change)
        self.db_session.add(model)
        await self.db_session.flush()
        return model.to_domain()

    async def for_run(self, workspace_id: str, run_id: str) -> list[FileChange]:
        rows = (await self.db_session.execute(select(FileChangeModel).where(
            FileChangeModel.workspace_id == workspace_id, FileChangeModel.run_id == run_id)
            .order_by(FileChangeModel.id))).scalars()
        return [row.to_domain() for row in rows]

    async def runs(self, workspace_id: str, limit: int) -> list[RunChangeRow]:
        last = func.max(FileChangeModel.created_at)
        manual = func.max(case((FileChangeModel.source == ChangeSource.MANUAL.value, 1), else_=0))
        rows = (await self.db_session.execute(
            select(FileChangeModel.run_id, FileChangeModel.session_id, func.count(FileChangeModel.id),
                   func.min(FileChangeModel.created_at), last, func.max(FileChangeModel.undo_of_run_id), manual)
            .where(FileChangeModel.workspace_id == workspace_id, FileChangeModel.run_id.is_not(None))
            .group_by(FileChangeModel.run_id, FileChangeModel.session_id)
            .order_by(last.desc(), FileChangeModel.run_id).limit(limit))).all()
        return [RunChangeRow(run_id=run_id, session_id=session_id, changes=count, first_at=first, last_at=last_at,
                             undo_of_run_id=undo_of, manual=bool(is_manual))
                for run_id, session_id, count, first, last_at, undo_of, is_manual in rows]

    async def object_by_hash(self, workspace_id: str, sha256: str) -> Optional[WorkspaceObject]:
        model = (await self.db_session.execute(select(WorkspaceObjectModel).where(
            WorkspaceObjectModel.workspace_id == workspace_id,
            WorkspaceObjectModel.sha256 == sha256))).scalar_one_or_none()
        return model.to_domain() if model is not None else None

    async def add_object(self, obj: WorkspaceObject) -> None:
        self.db_session.add(WorkspaceObjectModel(id=obj.id, workspace_id=obj.workspace_id, sha256=obj.sha256,
                                                 size=obj.size, key=obj.key, created_at=obj.created_at))
        await self.db_session.flush()

    async def get_objects(self, workspace_id: str, object_ids: list[str]) -> dict[str, WorkspaceObject]:
        if not object_ids:
            return {}
        rows = (await self.db_session.execute(select(WorkspaceObjectModel).where(
            WorkspaceObjectModel.workspace_id == workspace_id, WorkspaceObjectModel.id.in_(object_ids)))).scalars()
        return {row.id: row.to_domain() for row in rows}

    async def _drop(self, object_filter, change_filter) -> list[str]:
        keys = list((await self.db_session.execute(select(WorkspaceObjectModel.key).where(object_filter))).scalars())
        await self.db_session.execute(delete(FileChangeModel).where(change_filter)
                                      .execution_options(synchronize_session=False))
        await self.db_session.execute(delete(WorkspaceObjectModel).where(object_filter)
                                      .execution_options(synchronize_session=False))
        return keys

    async def agent_output_paths(self, workspace_id: str, root_id: str) -> set[str]:
        rows = (await self.db_session.execute(
            select(FileChangeModel.relative_path, FileChangeModel.operation, FileChangeModel.source)
            .where(
                FileChangeModel.workspace_id == workspace_id,
                FileChangeModel.entry_kind == EntryKind.FILE.value,
            )
            .order_by(FileChangeModel.id)
        )).all()
        origin: dict[str, str] = {}
        for path, operation, source in rows:
            if operation == ChangeOperation.DELETE.value:
                origin.pop(path, None)
            elif operation == ChangeOperation.CREATE.value:
                origin[path] = source
        outputs = {path for path, source in origin.items() if source == ChangeSource.TOOL.value}
        delivered = (await self.db_session.execute(
            select(FileModel.relative_path).where(
                FileModel.root_id == root_id,
                FileModel.relative_path.is_not(None),
            ).distinct()
        )).scalars().all()
        for path in delivered:
            if path and origin.get(path) not in (ChangeSource.UPLOAD.value, ChangeSource.MANUAL.value):
                outputs.add(path)
        return outputs

    async def delete_workspace(self, workspace_id: str) -> list[str]:
        return await self._drop(WorkspaceObjectModel.workspace_id == workspace_id,
                                FileChangeModel.workspace_id == workspace_id)

    async def delete_all(self) -> list[str]:
        return await self._drop(WorkspaceObjectModel.id.is_not(None), FileChangeModel.id.is_not(None))
