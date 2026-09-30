#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Protocol

from app.domain.models.project import (
    BrowseListing,
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
        """列出允许根目录内某一层的子目录"""
        ...
