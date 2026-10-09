"""长期项目登记、生命周期、对话归属及项目/会话共用的只读工作台。"""
import os
import asyncio
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
from app.domain.services.project_operations import require_writable
from app.domain.services.prompts.project import bounded_summaries

PROJECT_LOCKED_MESSAGE = "对话归属只能在首次运行前选择或更换"
SESSION_MISSING_MESSAGE = "该对话不存在，请核实后重试"
PROJECT_UNBOUND_MESSAGE = "对话没有关联项目"


class ProjectService:
    def __init__(self, uow_factory: Callable[[], IUnitOfWork], files: ProjectFiles,
                 storage, sandbox_address: Optional[str] = None, coordinator=None):
        self._uow_factory = uow_factory
        self._files = files
        self._storage = storage
        self._sandbox_address = sandbox_address or None
        self._coordinator = coordinator

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
            files_size=project.files_size, files_size_at=project.files_size_at, files_size_stale=project.files_size_stale,
            protection=project.protection, snapshot_gc_pending=project.snapshot_gc_pending,
            snapshots_cleaned_at=project.snapshots_cleaned_at, snapshots_released_bytes=project.snapshots_released_bytes,
            file_operation=project.file_operation,
            write_blocked_reason=(f"项目文件操作尚未结束：{project.file_operation.kind}/{project.file_operation.state}，{project.file_operation.error or project.file_operation.phase}" if project.file_operation else None),
            last_active_at=project.last_active_at)

    def describe_sessions(self, sessions: list[Session]) -> dict[str, Optional[ProjectView]]:
        projects = {session.project_id: session.project for session in sessions if session.project_id}
        views = {project_id: self.describe(project) for project_id, project in projects.items()}
        return {session.id: views.get(session.project_id) for session in sessions}

    def availability(self) -> tuple[bool, Optional[str]]:
        reason = "共享沙箱模式不支持托管项目" if self._sandbox_address else self._storage.reason
        return reason is None, reason

    async def create(self, name: str, instructions: Optional[str] = None, creation_id: str | None = None) -> WorkspaceProject:
        supported, reason = self.availability()
        if not supported:
            raise ConflictError(reason)
        candidate = WorkspaceProject(name=name, instructions=instructions)
        if creation_id:
            candidate.id = creation_id
        async with self._uow_factory() as uow:
            if creation_id:
                await uow.project.lock_creation('project:' + creation_id)
                existing = await uow.project.get(creation_id)
                if existing:
                    return existing
            await asyncio.to_thread(self._storage.ensure_project, candidate.id)
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
            active = await uow.run.active_projects([project.id for project in projects])
        views = []
        for project in projects:
            view = self.describe(project)
            run = active.get(project.id)
            views.append(view.model_copy(update={"task_count": counts.get(project.id, 0),
                "occupying_session_id": run.session_id if run else None,
                "active_run_status": run.status.value if run else None,
                "active_run_reason": run.reason if run else None}))
        return views, total

    async def detail(self, project_id: str):
        project = await self.get(project_id)
        async with self._uow_factory() as uow:
            counts = await uow.session.project_counts([project.id])
            occupied = await uow.run.get_active_project(project.id)
        return {**project.model_dump(mode="json"), **self.describe(project).model_dump(mode="json"),
            "task_count": counts.get(project.id, 0), "occupying_session_id": occupied.session_id if occupied else None,
            "active_run_status": occupied.status.value if occupied else None,
            "active_run_reason": occupied.reason if occupied else None}

    async def update(self, project_id: str, settings: ProjectSettings, *, base_version: int | None = None,
                     notes: str | None = None, notes_version: int | None = None) -> WorkspaceProject:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            if base_version is None or base_version != project.settings_version:
                error = ConflictError("项目设置版本冲突，请保留草稿，按最新内容合并后保存")
                error.data = dict(name=project.name, instructions=project.instructions, settings_version=project.settings_version)
                raise error
            if notes is not None and notes_version != project.notes_version:
                raise ConflictError("项目笔记版本冲突，请重新加载后合并修改")
            if (settings.name == project.name and settings.instructions == project.instructions
                    and (notes is None or notes == project.notes)):
                return project
            updated = project.model_copy(update={**settings.model_dump(), "settings_version": project.settings_version + 1,
                "updated_at": datetime.now()})
            await uow.project.audit(project_id, 'project_settings', dict(name=updated.name,
                instructions=updated.instructions, settings_version=updated.settings_version, source='user'))
            if notes is not None:
                if len(notes) > 8000 or '\x00' in notes:
                    raise BadRequestError('项目笔记不能超过 8000 字符或包含 NUL')
                updated.notes, updated.notes_version = notes, project.notes_version + 1
                await uow.project.audit(project_id, 'project_notes', dict(content=notes,
                    notes_version=updated.notes_version, source='user'))
            await uow.project.save(updated)
        return updated

    async def archive(self, project_id: str, archived: bool) -> WorkspaceProject:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            require_writable(project)
            occupied = await uow.run.get_active_project(project_id)
            if occupied:
                raise ProjectRunConflict("项目仍有活动对话，结束或停止后才能归档", occupied.session_id)
            if not archived:
                self.validate_start(project.id)
            project.archived_at = datetime.now() if archived else None
            project.updated_at = datetime.now()
            await uow.project.save(project)
        return project

    async def create_session(self, project_id: str, creation_id: str | None = None) -> Session:
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError("项目不存在")
            if creation_id:
                existing = await uow.session.get_by_id(creation_id)
                if existing:
                    if existing.project_id != project_id:
                        raise ConflictError('创建标识属于其他项目')
                    return existing
            if project.archived_at:
                raise ConflictError("项目已归档，请先恢复")
            require_writable(project)
            occupied = await uow.run.get_active_project(project_id)
            if occupied:
                raise ProjectRunConflict('项目有活动对话，请返回占用对话', occupied.session_id)
            self.validate_start(project.id)
            session = Session(title=DEFAULT_SESSION_TITLE, project_id=project.id, project=project)
            if creation_id:
                session.id = creation_id
            await uow.session.save(session)
        return session

    async def prepare_snapshot(self, uow: IUnitOfWork, session: Session) -> None:
        """受理读取项目元数据；文件快照与运行输入冻结另由后台协调。"""
        if not session.project:
            return
        project = await uow.project.get(session.project_id, lock=True)
        self.validate_start(project.id)
        session.project = project
        session.project_snapshot = await self.memory_snapshot(uow, session, project)
        await uow.session.save_project_snapshot(session.id, session.project_snapshot.model_dump(mode="json"))
        project.last_active_at = datetime.now()
        await uow.project.save(project)

    async def memory_snapshot(self, uow, session, project=None):
        # 所有元数据写入均先锁项目，保证说明、笔记及摘要来自同一受理视图。
        project = project or await uow.project.get(session.project_id, lock=True)
        summaries = await uow.session.recent_summaries(project.id, session.id)
        return ProjectTaskSnapshot(project_id=project.id, **project.model_dump(include={
            'name', 'instructions', 'notes', 'notes_version', 'settings_version'}),
            summaries=bounded_summaries(summaries))

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

    async def require_file_root(self, identifier: str, *, project_level: bool = False) -> str:
        """共用只读来源解析，不创建沙箱或更改项目占用。"""
        return await self._require_project(identifier, project_level=project_level)

    async def read_file(self, identifier: str, relative: str, *, project_level: bool = False) -> ProjectFile:
        path = await self._require_project(identifier, project_level=project_level)
        return await self._read(self._files.read_file(path, relative))

    @staticmethod
    async def _read(awaitable):
        try:
            return await awaitable
        except ProjectPathError as exc:
            raise BadRequestError(exc.check.message or "路径校验失败") from exc

    async def retry_settling(self, project_id):
        await self.get(project_id)
        if self._coordinator is None:
            raise ConflictError('项目环境协调器不可用')
        await self._coordinator.retry_settling(project_id)

    async def events(self, project_id, after_seq=0, limit=50):
        await self.get(project_id)
        async with self._uow_factory() as uow:
            return await uow.project.events(project_id, after_seq, limit)

    async def memory_view(self, project_id, exclude_session_id=None):
        """与受理使用同一项目段选择；当前预览不保证未来受理内容不变。"""
        from app.domain.services.prompts.project import snapshot_prompt
        async with self._uow_factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if project is None:
                raise NotFoundError('项目不存在')
            if exclude_session_id:
                session = await uow.session.get_by_id(exclude_session_id)
                if not session or session.project_id != project_id:
                    raise BadRequestError('当前对话不属于该项目')
            candidates = await uow.session.recent_summaries(project_id, exclude_session_id or '')
            selected = bounded_summaries(candidates)
            snapshot = ProjectTaskSnapshot(project_id=project_id, **project.model_dump(include={
                'name', 'instructions', 'notes', 'notes_version', 'settings_version'}), summaries=selected)
            active = await uow.run.get_active_project(project_id)
            frozen = None
            if active:
                current = await uow.session.get_by_id(active.session_id)
                frozen = active.config_snapshot.get('project_context') or (current.project_snapshot.model_dump(mode='json') if current.project_snapshot else None)
        return dict(project=snapshot.model_dump(mode='json'), candidates=candidates,
            project_prompt=snapshot_prompt(snapshot), frozen=frozen,
            active_run_id=active.id if active else None, occupying_session_id=active.session_id if active else None)

    async def memory_history(self, project_id, before_seq=0, limit=20):
        await self.get(project_id)
        async with self._uow_factory() as uow:
            return await uow.project.memory_history(project_id, before_seq, limit)
