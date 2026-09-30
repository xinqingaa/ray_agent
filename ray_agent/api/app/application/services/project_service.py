#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话与宿主机项目目录的绑定，以及文件树、读文件、Git 只读接口的应用层协调。

不放进 AgentService：绑定发生在首次运行之前，文件与 Git 读取不经过沙箱。
"""
import os
from datetime import datetime
from typing import Callable, List, Optional, Sequence

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.external.project import ProjectFiles, ProjectGit
from app.domain.models.project import (
    BrowseListing,
    GitDiff,
    GitDiffScope,
    GitStatus,
    ProjectFile,
    ProjectListing,
    ProjectPathError,
    ProjectRoot,
    ProjectView,
)
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.project_paths import check_project_path, resolve_roots
from app.domain.services.session_locks import session_lock

NO_ROOTS_MESSAGE = "未配置允许的项目根目录"
SHARED_SANDBOX_MESSAGE = "共享沙箱模式（已设置 SANDBOX_ADDRESS）不支持绑定项目"
PROJECT_LOCKED_MESSAGE = "项目只能在首次运行前选择或更换"
SESSION_MISSING_MESSAGE = "该会话不存在，请核实后重试"
PROJECT_UNBOUND_MESSAGE = "会话没有绑定项目"


class ProjectService:
    """项目绑定与只读读取。roots 与 sandbox_address 取构造时的配置。"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            files: ProjectFiles,
            git: ProjectGit,
            roots: Sequence[str],
            sandbox_address: Optional[str] = None,
    ) -> None:
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._files = files
        self._git = git
        self._roots = list(roots)
        self._sandbox_address = sandbox_address or None

    def describe(self, project_path: Optional[str]) -> Optional[ProjectView]:
        """把会话上的 project_path 变成对外的 project 对象。空路径为 None，不访问文件系统。"""
        if not project_path:
            return None
        check = check_project_path(project_path, self._roots)
        name = os.path.basename(project_path.rstrip("/")) or project_path
        return ProjectView(
            path=project_path,
            name=name,
            available=check.ok,
            reason=None if check.ok else check.message,
        )

    def validate_start(self, project_path: str) -> None:
        """每次启动/续接检查当前许可与规范路径，已有沙箱也不能绕过。"""
        if self._sandbox_address:
            raise ConflictError(SHARED_SANDBOX_MESSAGE)
        check = check_project_path(project_path, self._roots)
        if not check.ok:
            raise ConflictError(check.message or "项目目录不可用")
        if check.real_path != project_path:
            raise ConflictError("项目路径已被替换，请恢复原目录或重新添加项目")
        if os.path.isfile(os.path.join(project_path, ".git")):
            raise ConflictError("暂不支持 .git 文件或 linked worktree，请使用普通仓库目录")

    def availability(self) -> tuple[bool, Optional[str]]:
        if self._sandbox_address:
            return False, SHARED_SANDBOX_MESSAGE
        return True, None if self._roots else NO_ROOTS_MESSAGE

    def list_roots(self) -> tuple[bool, List[ProjectRoot]]:
        """enabled 表示配置了 PROJECT_ROOTS；不可用的根目录仍返回，available 为 false。"""
        return bool(self._roots), resolve_roots(self._roots)

    async def browse(self, path: str) -> BrowseListing:
        return await self._read(self._files.browse(path))

    async def list_recent(self, limit: int = 10) -> List[ProjectView]:
        """按 project_path 分组，组内取最大 updated_at，再按该时间倒序。"""
        async with self._uow:
            sessions = await self._uow.session.get_all()
        latest: dict[str, datetime] = {}
        for session in sessions:
            path = session.project_path
            if not path:
                continue
            current = latest.get(path)
            if current is None or session.updated_at > current:
                latest[path] = session.updated_at
        ordered = sorted(latest.items(), key=lambda item: (item[1], item[0]), reverse=True)
        views = []
        for path, _updated in ordered[:limit]:
            view = self.describe(path)
            if view is not None:
                views.append(view)
        return views

    async def bind(self, session_id: str, path: str) -> ProjectView:
        """绑定或更换项目。成功后保存校验得到的 realpath，并返回 project 对象。"""
        async with session_lock(session_id):
            session, runs = await self._load_for_bind(session_id)
            self._ensure_bindable(session, runs)
            if not self._roots:
                raise BadRequestError(NO_ROOTS_MESSAGE)
            check = check_project_path(path, self._roots)
            if not check.ok or not check.real_path:
                raise BadRequestError(check.message or "路径校验失败")
            async with self._uow:
                await self._uow.session.set_project_path(session_id, check.real_path)
            view = self.describe(check.real_path)
            if view is None:
                raise BadRequestError("路径校验失败")
            return view

    async def unbind(self, session_id: str) -> None:
        """解除绑定。已经没有项目时同样成功。"""
        async with session_lock(session_id):
            session, runs = await self._load_for_bind(session_id)
            self._ensure_bindable(session, runs)
            async with self._uow:
                await self._uow.session.set_project_path(session_id, None)

    async def tree(self, session_id: str, relative: str = "") -> ProjectListing:
        project_path = await self._require_project(session_id)
        return await self._read(self._files.list_directory(project_path, relative or ""))

    async def read_file(self, session_id: str, relative: str) -> ProjectFile:
        project_path = await self._require_project(session_id)
        return await self._read(self._files.read_file(project_path, relative))

    async def git_status(self, session_id: str) -> GitStatus:
        project_path = await self._require_project(session_id)
        return await self._read(self._git.status(project_path))

    async def git_diff(self, session_id: str, scope: str = "worktree", path: Optional[str] = None) -> GitDiff:
        if scope not in ("worktree", "staged"):
            raise BadRequestError("diff 范围只能是 worktree 或 staged")
        project_path = await self._require_project(session_id)
        relative = path or None
        diff_scope: GitDiffScope = "worktree" if scope == "worktree" else "staged"
        return await self._read(self._git.diff(project_path, scope=diff_scope, path=relative))

    async def _load_for_bind(self, session_id: str):
        async with self._uow:
            session = await self._uow.session.get_by_id(session_id)
            runs = await self._uow.run.list_by_session(session_id) if session else []
        return session, runs

    def _ensure_bindable(self, session, runs) -> None:
        if session is None:
            raise NotFoundError(SESSION_MISSING_MESSAGE)
        if self._sandbox_address:
            raise ConflictError(SHARED_SANDBOX_MESSAGE)
        if runs or session.sandbox_id:
            raise ConflictError(PROJECT_LOCKED_MESSAGE)

    async def _require_project(self, session_id: str) -> str:
        async with self._uow:
            session = await self._uow.session.get_by_id(session_id)
        if session is None:
            raise NotFoundError(SESSION_MISSING_MESSAGE)
        if not session.project_path:
            raise NotFoundError(PROJECT_UNBOUND_MESSAGE)
        return session.project_path

    @staticmethod
    async def _read(awaitable):
        try:
            return await awaitable
        except ProjectPathError as exc:
            raise BadRequestError(exc.check.message or "路径校验失败") from exc
