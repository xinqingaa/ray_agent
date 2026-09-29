#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional, Protocol

from app.domain.models.project import (
    BrowseListing,
    GitDiff,
    GitDiffScope,
    GitStatus,
    ProjectFile,
    ProjectListing,
)


class ProjectFiles(Protocol):
    """项目目录的只读浏览。每次调用都先做路径校验，不通过时抛出 ``ProjectPathError``。"""

    async def list_directory(self, project_path: str, relative: str = "") -> ProjectListing:
        """列出项目内某个目录的直接子项"""
        ...

    async def read_file(self, project_path: str, relative: str) -> ProjectFile:
        """读取项目内一个文件；二进制与过大的文件只返回元数据"""
        ...

    async def browse(self, path: str) -> BrowseListing:
        """列出允许根目录内某一层的子目录，并标出哪些是 Git 仓库"""
        ...


class ProjectGit(Protocol):
    """项目目录的 Git 只读读取。项目路径或文件路径校验不通过时抛出 ``ProjectPathError``；
    不是仓库、超时与其他 git 错误以 ``state`` 返回。"""

    async def status(self, project_path: str) -> GitStatus:
        """分支、上游、领先落后与改动条目"""
        ...

    async def diff(self, project_path: str, scope: GitDiffScope = "worktree", path: Optional[str] = None) -> GitDiff:
        """工作区相对暂存区，或暂存区相对 HEAD；带 path 时只取该文件"""
        ...
