#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List, Optional

from pydantic import BaseModel, Field


class CreateProjectRequest(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(min_length=1, max_length=160)
    instructions: Optional[str] = Field(default=None, max_length=8000)


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
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    occupying_session_id: Optional[str] = None
