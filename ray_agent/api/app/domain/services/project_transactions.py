"""固定锁顺序：项目行（按 id）→会话行→运行行。锁与受理共用事务。"""
from typing import Optional

from app.domain.models.session import Session
from app.domain.repositories.uow import IUnitOfWork


class ProjectRunConflict(RuntimeError):
    def __init__(self, message: str, occupying_session_id: Optional[str] = None, *, operation=None, project_id=None):
        self.occupying_session_id = occupying_session_id
        self.operation = operation
        self.project_id = project_id
        super().__init__(message)


async def lock_project_session(uow: IUnitOfWork, session_id: str, *, target_project_id: Optional[str] = None) -> Optional[Session]:
    before = await uow.session.get_by_id(session_id)
    if before is None:
        return None
    ids = sorted({item for item in (before.project_id, target_project_id) if item})
    for project_id in ids:
        if await uow.project.get(project_id, lock=True) is None:
            raise ProjectRunConflict("项目不存在，请刷新对话归属")
    current = await uow.session.lock(session_id)
    if current and current.project_id != before.project_id:
        raise ProjectRunConflict("对话归属刚刚发生变化，请刷新后重新发送")
    return current


async def ensure_project_start(uow: IUnitOfWork, session: Optional[Session]) -> None:
    if session is None or not session.project_id:
        return
    project = await uow.project.get(session.project_id)
    if project is None:
        raise ProjectRunConflict("项目不存在，请刷新对话归属")
    if project.archived_at is not None:
        raise ProjectRunConflict("项目已归档，请先恢复后开始运行")
    from app.domain.services.project_operations import require_writable
    require_writable(project)
    occupied = await uow.run.get_active_project(project.id, exclude_session=session.id)
    if occupied:
        raise ProjectRunConflict("项目正在被另一段对话占用，请返回占用对话或停止其运行", occupied.session_id)
