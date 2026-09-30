"""长期项目登记、生命周期、对话归属及项目/会话共用的只读工作台。"""
import os
from datetime import datetime
from typing import Callable, Optional, Sequence

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.external.project import ProjectFiles
from app.domain.models.project import (
    BrowseListing, ProjectFile, ProjectListing,
    ProjectPathError, ProjectRoot, ProjectView,
)
from app.domain.models.workspace_project import WorkspaceProject, ProjectSettings, ProjectTaskSnapshot
from app.domain.models.session import Session, DEFAULT_SESSION_TITLE
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.project_paths import check_project_path, resolve_roots
from app.domain.services.project_transactions import lock_project_session, ProjectRunConflict
from app.domain.services.session_locks import session_lock

NO_ROOTS_MESSAGE = "未配置允许的项目根目录"
SHARED_SANDBOX_MESSAGE = "共享沙箱模式（已设置 SANDBOX_ADDRESS）不支持本机项目"
PROJECT_LOCKED_MESSAGE = "对话归属只能在首次运行前选择或更换"
SESSION_MISSING_MESSAGE = "该对话不存在，请核实后重试"
PROJECT_UNBOUND_MESSAGE = "对话没有关联项目"


class ProjectService:
    def __init__(self, uow_factory: Callable[[], IUnitOfWork], files: ProjectFiles,
                 roots: Sequence[str], sandbox_address: Optional[str] = None):
        self._uow_factory = uow_factory
        self._files = files
        self._roots = list(roots)
        self._sandbox_address = sandbox_address or None

    def validate_start(self, project_path: str, directory_identity: Optional[str] = None) -> None:
        if self._sandbox_address:
            raise ConflictError(SHARED_SANDBOX_MESSAGE)
        check = check_project_path(project_path, self._roots)
        if not check.ok:
            raise ConflictError(check.message or "项目目录不可用")
        if check.real_path != project_path:
            raise ConflictError("项目路径已被替换，请恢复原目录或重新添加项目")
        if directory_identity is not None and self.directory_identity(project_path) != directory_identity:
            raise ConflictError("项目目录已被同路径替换，请恢复原目录或从工作区重新添加")

    @staticmethod
    def directory_identity(path: str) -> str:
        stat = os.stat(path)
        return f"{stat.st_dev}:{stat.st_ino}"

    def describe(self, project: Optional[WorkspaceProject]) -> Optional[ProjectView]:
        if project is None:
            return None
        try:
            self.validate_start(project.path)
            available, reason = True, None
        except (ConflictError, OSError) as exc:
            available, reason = False, str(exc)
        return ProjectView(id=project.id, path=project.path, name=project.name,
            available=available, reason=reason, archived=project.archived_at is not None,
            last_active_at=project.last_active_at)

    def describe_sessions(self, sessions: list[Session]) -> dict[str, Optional[ProjectView]]:
        projects = {session.project_id: session.project for session in sessions if session.project_id}
        views = {project_id: self.describe(project) for project_id, project in projects.items()}
        return {session.id: views.get(session.project_id) for session in sessions}

    def availability(self) -> tuple[bool, Optional[str]]:
        if self._sandbox_address:
            return False, SHARED_SANDBOX_MESSAGE
        return True, None if self._roots else NO_ROOTS_MESSAGE

    def list_roots(self) -> tuple[bool, list[ProjectRoot]]:
        return bool(self._roots), resolve_roots(self._roots)

    async def browse(self, path: str) -> BrowseListing:
        if self._sandbox_address:
            raise ConflictError(SHARED_SANDBOX_MESSAGE)
        return await self._read(self._files.browse(path))

    async def register(self, path: str, name: Optional[str] = None) -> WorkspaceProject:
        check = check_project_path(path, self._roots)
        if not check.ok or not check.real_path:
            raise BadRequestError(check.message or "路径校验失败")
        self.validate_start(check.real_path)
        candidate = WorkspaceProject(path=check.real_path, name=name or (os.path.basename(check.real_path) or '/')[:160])
        async with self._uow_factory() as uow:
            await uow.project.lock_registry()
            existing = await uow.project.get_by_path(candidate.path)
            if existing:
                return existing
            overlap = await uow.project.overlapping(candidate.path)
            if overlap:
                raise ConflictError(f"目录与已登记项目「{overlap.name}」重叠，请选择互不嵌套的目录")
            return await uow.project.create_or_get(candidate)

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
                self.validate_start(project.path)
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
            self.validate_start(project.path)
            session = Session(title=DEFAULT_SESSION_TITLE, project_id=project.id, project=project)
            await uow.session.save(session)
        return session

    async def bind(self, session_id: str, project_id: str) -> ProjectView:
        async with session_lock(session_id):
            async with self._uow_factory() as uow:
                session = await lock_project_session(uow, session_id, target_project_id=project_id)
                await self._ensure_bindable(uow, session)
                project = await uow.project.get(project_id)
                if project is None:
                    raise NotFoundError("项目不存在")
                if project.archived_at:
                    raise ConflictError("项目已归档，请先恢复")
                self.validate_start(project.path)
                await uow.session.set_project_id(session_id, project.id)
            return self.describe(project)

    async def unbind(self, session_id: str) -> None:
        async with session_lock(session_id):
            async with self._uow_factory() as uow:
                session = await lock_project_session(uow, session_id)
                await self._ensure_bindable(uow, session)
                await uow.session.set_project_id(session_id, None)

    @staticmethod
    async def _ensure_bindable(uow, session):
        if session is None:
            raise NotFoundError(SESSION_MISSING_MESSAGE)
        if session.sandbox_id or await uow.run.list_by_session(session.id):
            raise ConflictError(PROJECT_LOCKED_MESSAGE)

    async def prepare_snapshot(self, uow: IUnitOfWork, session: Session) -> None:
        """项目与会话已锁定；与首次受理同事务冻结设置，不在打开项目时预取。"""
        if not session.project:
            return
        self.validate_start(session.project.path,
            session.project_snapshot.directory_identity if session.project_snapshot else None)
        if session.project_snapshot is None:
            project = session.project
            session.project_snapshot = ProjectTaskSnapshot(project_id=project.id,
                **project.model_dump(include={"path", "name", "instructions"}),
                directory_identity=self.directory_identity(project.path))
            await uow.session.save_project_snapshot(session.id, session.project_snapshot.model_dump(mode="json"))
        project = session.project
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
        self.validate_start(project.path)
        return project.path

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
