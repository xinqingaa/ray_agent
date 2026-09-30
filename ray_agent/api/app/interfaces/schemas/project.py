#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List, Optional

from pydantic import BaseModel, Field


class BindProjectRequest(BaseModel):
    """绑定或更换会话项目。path 是宿主机上的目录，服务端会再做路径校验并保存 realpath。"""
    path: str


class ProjectRootItem(BaseModel):
    path: str
    available: bool
    reason: Optional[str] = None


class ProjectRootsResponse(BaseModel):
    """enabled 为 PROJECT_ROOTS 非空。不可用的根目录仍列出，available 为 false。"""
    enabled: bool
    supported: bool = True
    reason: Optional[str] = None
    roots: List[ProjectRootItem] = Field(default_factory=list)
