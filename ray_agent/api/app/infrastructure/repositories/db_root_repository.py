"""可访问根的 SQLite 实现。"""
from datetime import datetime
from typing import Optional, Tuple

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.identity import RootKind, RootRef
from app.domain.models.workspace import FolderStatus, RootRecord
from app.domain.repositories.root_repository import RootRepository
from app.infrastructure.models import RootModel


def _record(model: RootModel) -> RootRecord:
    return RootRecord(
        ref=RootRef(root_id=model.id, kind=RootKind(model.kind), session_id=model.session_id,
                    workspace_id=model.workspace_id),
        location=model.location, dev=model.fs_dev, ino=model.fs_ino, status=FolderStatus(model.folder_status),
        marker_writable=model.marker_writable, checked_at=model.checked_at)


class DBRootRepository(RootRepository):

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add(self, root: RootRef, location: str, *, dev: Optional[int] = None, ino: Optional[int] = None,
                  marker_writable: bool = True) -> None:
        self.db_session.add(RootModel(id=root.root_id, kind=root.kind.value, session_id=root.session_id,
                                      workspace_id=root.workspace_id, location=location, fs_dev=dev, fs_ino=ino,
                                      marker_writable=marker_writable))
        await self.db_session.flush()

    async def session_workdir(self, session_id: str) -> Optional[Tuple[RootRef, str]]:
        record = (await self.db_session.execute(select(RootModel).where(
            RootModel.session_id == session_id, RootModel.kind == RootKind.SESSION_WORKDIR.value))).scalar_one_or_none()
        if record is None:
            return None
        return RootRef(root_id=record.id, kind=RootKind(record.kind), session_id=record.session_id,
                       workspace_id=record.workspace_id), record.location

    async def get(self, root_id: str) -> Optional[RootRecord]:
        model = await self.db_session.get(RootModel, root_id, populate_existing=True)
        return _record(model) if model is not None else None

    async def workspace_folder(self, workspace_id: str) -> Optional[RootRecord]:
        model = (await self.db_session.execute(select(RootModel).where(
            RootModel.workspace_id == workspace_id,
            RootModel.kind == RootKind.WORKSPACE_FOLDER.value))).scalar_one_or_none()
        return _record(model) if model is not None else None

    async def workspace_folders(self) -> list[RootRecord]:
        rows = (await self.db_session.execute(select(RootModel).where(
            RootModel.kind == RootKind.WORKSPACE_FOLDER.value))).scalars().all()
        return [_record(model) for model in rows]

    async def rebind_folder(self, root_id: str, *, location: str, dev: int, ino: int, marker_writable: bool,
                            checked_at: datetime) -> None:
        await self.db_session.execute(update(RootModel).where(RootModel.id == root_id).values(
            location=location, fs_dev=dev, fs_ino=ino, marker_writable=marker_writable,
            folder_status=FolderStatus.AVAILABLE.value, checked_at=checked_at))

    async def set_folder_state(self, root_id: str, status: FolderStatus, checked_at: datetime) -> None:
        await self.db_session.execute(update(RootModel).where(RootModel.id == root_id).values(
            folder_status=status.value, checked_at=checked_at))

    async def remove(self, root_id: str) -> None:
        await self.db_session.execute(delete(RootModel).where(RootModel.id == root_id))
