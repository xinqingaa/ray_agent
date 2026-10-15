#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List

from pydantic import BaseModel, Field


class SkillSelection(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$", max_length=64)
    version: str = Field(pattern=r"^[a-f0-9]{64}$")


class Message(BaseModel):
    """用户传递的消息"""
    skill: SkillSelection | None = None
    message: str = ""  # 用户发送的消息
    attachments: List[str] = Field(default_factory=list)  # 用户发送的附件
    images: List[dict] = Field(default_factory=list)  # 已校验的用户图片引用，不存像素
    image_mode: str = 'auto'
    image_input_note: str | None = None
