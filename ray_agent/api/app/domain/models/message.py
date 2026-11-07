#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List, Optional

from pydantic import BaseModel, Field


class SkillSelection(BaseModel):
    """显式选择使用稳定 skill_id 与内容版本，不以可见名称冒充身份。"""
    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$", max_length=128)
    version: str = Field(pattern=r"^[a-f0-9]{64}$")


class Message(BaseModel):
    """用户传递的消息"""
    skill: SkillSelection | None = None
    message: str = ""  # 用户发送的消息
    attachments: List[str] = Field(default_factory=list)  # 用户发送的附件
    images: List[dict] = Field(default_factory=list)  # 已校验的用户图片引用，不存像素
    image_mode: str = 'auto'
    image_input_note: str | None = None
    input_id: Optional[int] = None  # 来自持久输入时的输入身份，进入模型历史时随上下文事件消费
