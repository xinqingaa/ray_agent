"""长期项目登记、生命周期、对话归属及项目/会话共用的只读工作台。"""
import os
from datetime import datetime
from typing import Callable, Optional, Sequence

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.external.project import ProjectFiles
from app.domain.models.project import (
    ProjectFile, ProjectListing,
    ProjectPathError, ProjectView,
)
from app.domain.models.workspace_project import WorkspaceProject, ProjectSettings, ProjectTaskSnapshot
from app.domain.models.session import Session, DEFAULT_SESSION_TITLE
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.project_transactions import lock_project_session, ProjectRunConflict
from app.domain.services.session_locks import session_lock

PROJECT_LOCKED_MESSAGE = "对话归属只能在首次运行前选择或更换"
SESSION_MISSING_MESSAGE = "该对话不存在，请核实后重试"
PROJECT_UNBOUND_MESSAGE = "对话没有关联项目"


class ProjectService:
    def __init__(self, uow_factory: Callable[[], IUnitOfWork], files: ProjectFiles,
                 storage, sandbox_address: Optional[str] = None):
        self._uow_factory = uow_factory
        self._files = files
        self._storage = storage
        self._sandbox_address = sandbox_address or None

    def validate_start(self, project_id: str) -> None:
        if self._sandbox_address:
            raise ConflictError("共享沙箱模式不支持托管项目，请启用动态沙箱")
        try:
            self._storage.validate(project_id)
        except (ValueError, OSError) as exc:
            raise ConflictError(str(exc)) from exc

    def describe(self, project: Optional[WorkspaceProject]) -> Optional[ProjectView]:
        if project is None:
            return None
        try:
            self.validate_start(project.id)
            available, reason = True, None
        except (ConflictError, OSError) as exc:
            available, reason = False, str(exc)
        return ProjectView(id=project.id, name=project.name,
            available=available, reason=reason, archived=project.archived_at is not None,
            last_active_at=project.last_active_at)

    def describe_sessions(self, sessions: list[Session]) -> dict[str, Optional[ProjectView]]:
        projects = {session.project_id: session.project for session in sessions if session.project_id}
        views = {project_id: self.describe(project) for project_id, project in projects.items()}
        return {session.id: views.get(session.project_id) for session in sessions}

    def availability(self) -> tuple[bool, Optional[str]]:
        reason = "共享沙箱模式不支持托管项目" if self._sandbox_address else self._storage.reason
        return reason is None, reason

    async def create(self, name: str, instructions: Optional[str] = None) -> WorkspaceProject:
        supported, reason = self.availability()
        if not supported:
            raise ConflictError(reason)
        candidate = WorkspaceProject(name=name, instructions=instructions)
        self._storage.ensure_project(candidate.id)
        async with self._uow_factory() as uow:
            return await uow.project.create(candidate)

    async def get(self, project_id: str) -> WorkspaceProject:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id)
        if project is None:
            raise NotFoundError("项目不存在，请刷新后重试")
        return project

    async def page(self, *, archived: bool = False, offset: int = 0, limit: int = 50):
        async with self._uow_factory() as uow:
            projects, total = await uow.project.page(archived=archived, offset=offset, limit=limit)
            counts = await uow.session.project_counts([project.id for project in projects])
        views = []
        for project in projects:
            view = self.describe(project)
            views.append(view.model_copy(update={"task_count": counts.get(project.id, 0)}))
        return views, total

    async def detail(self, project_id: str):
        project = await self.get(project_id)
        async with self._uow_factory() as uow:
            counts = await uow.session.project_counts([project.id])
            occupied = await uow.run.get_active_project(project.id)
        return {**project.model_dump(mode="json"), **self.describe(project).model_dump(mode="json"),
            "task_count": counts.get(project.id, 0), "occupying_session_id": occupied.session_id if occupied else None}

    async def update(self, project_id: str, settings: ProjectSettings) -> WorkspaceProject:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            updated = project.model_copy(update={**settings.model_dump(), "updated_at": datetime.now()})
            await uow.project.save(updated)
        return updated

    async def archive(self, project_id: str, archived: bool) -> WorkspaceProject:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            occupied = await uow.run.get_active_project(project_id)
            if archived and occupied:
                raise ProjectRunConflict("项目仍有活动对话，结束或停止后才能归档", occupied.session_id)
            if not archived:
                self.validate_start(project.id)
            project.archived_at = datetime.now() if archived else None
            project.updated_at = datetime.now()
            await uow.project.save(project)
        return project

    async def create_session(self, project_id: str) -> Session:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            if project.archived_at:
                raise ConflictError("项目已归档，请先恢复")
            self.validate_start(project.id)
            session = Session(title=DEFAULT_SESSION_TITLE, project_id=project.id, project=project)
            await uow.session.save(session)
        return session

    async def prepare_snapshot(self, uow: IUnitOfWork, session: Session) -> None:
        """受理读取项目元数据；文件快照与运行输入冻结另由后台协调。"""
        if not session.project:
            return
        project = session.project
        self.validate_start(project.id)
        session.project_snapshot = ProjectTaskSnapshot(project_id=project.id,
            **project.model_dump(include={"name", "instructions"}))
        await uow.session.save_project_snapshot(session.id, session.project_snapshot.model_dump(mode="json"))
        project.last_active_at = datetime.now()
        await uow.project.save(project)

    async def sessions(self, project_id: str, offset: int = 0, limit: int = 50):
        await self.get(project_id)
        async with self._uow_factory() as uow:
            return await uow.session.page(project_id=project_id, offset=offset, limit=limit)

    async def _require_project(self, identifier: str, *, project_level: bool) -> str:
        if project_level:
            project = await self.get(identifier)
        else:
            async with self._uow_factory() as uow:
                session = await uow.session.get_by_id(identifier)
            if session is None:
                raise NotFoundError(SESSION_MISSING_MESSAGE)
            project = session.project
            if project is None:
                raise NotFoundError(PROJECT_UNBOUND_MESSAGE)
        self.validate_start(project.id)
        return str(self._storage.files_path(project.id))

    async def tree(self, identifier: str, relative: str = "", *, project_level: bool = False) -> ProjectListing:
        path = await self._require_project(identifier, project_level=project_level)
        return await self._read(self._files.list_directory(path, relative or ""))

    async def read_file(self, identifier: str, relative: str, *, project_level: bool = False) -> ProjectFile:
        path = await self._require_project(identifier, project_level=project_level)
        return await self._read(self._files.read_file(path, relative))

    @staticmethod
    async def _read(awaitable):
        try:
            return await awaitable
        except ProjectPathError as exc:
            raise BadRequestError(exc.check.message or "路径校验失败") from exc
