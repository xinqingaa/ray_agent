#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List, Optional

from uuid import UUID
from pydantic import BaseModel, Field


class CreateProjectRequest(BaseModel):
    creation_id: UUID | None = None
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
    notes: str = ''
    notes_version: int = 0
    settings_version: int = 0
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    occupying_session_id: Optional[str] = None


class UpdateProjectRequest(ProjectSettings):
    settings_version: int = Field(ge=0)
    notes: str | None = Field(default=None, max_length=8000)
    notes_version: int | None = Field(default=None, ge=0)


class UpdateProjectNotesRequest(BaseModel):
    content: str = Field(max_length=8000)
    base_version: int = Field(ge=0)
