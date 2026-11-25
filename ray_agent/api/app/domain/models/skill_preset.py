"""内置场景预设与基础能力元数据的领域模型（前后端单一真相源）。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class PresetStarter(BaseModel):
    """首页预设点选后输入框下方的轻起手按钮。"""
    label: str
    prompt: str


class PresetDefinition(BaseModel):
    """前端首页与后端会话绑定的场景预设元数据。"""
    id: str
    title: str
    subtitle: str
    icon: str
    placeholder: str
    starters: list[PresetStarter] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    default_participate_in_memory: bool = True
    order: int = 0


class BuiltinSkillSpec(BaseModel):
    """随包内置 Skill 条目规范（系统 / 基础能力 / 场景预设）。"""
    id: str
    category: Literal["system", "foundation", "preset"]
    default_included: bool = True
    preset: Optional[PresetDefinition] = None
