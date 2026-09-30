#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List, Optional

from pydantic import BaseModel, Field


class BindProjectRequest(BaseModel):
    """首次受理前按项目 id 更换归属。"""
    project_id: str = Field(min_length=1, max_length=255)


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


class CreateProjectRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)


class ArchiveProjectRequest(BaseModel):
    archived: bool

from datetime import datetime
from app.domain.models.project import ProjectView
from app.domain.models.workspace_project import ProjectSettings


class ProjectPage(BaseModel):
    projects: List[ProjectView]
    total: int
    offset: int
    limit: int


class ProjectDetails(ProjectView):
    instructions: Optional[str] = None
    git_author_name: Optional[str] = None
    git_author_email: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    occupying_session_id: Optional[str] = None
