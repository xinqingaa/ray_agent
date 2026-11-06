#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid

from pydantic import BaseModel, Field


class File(BaseModel):
    """文件信息Domain模型，用于记录用户上传或 Agent 交付的文件；字节保存为数据根中的内容对象"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 文件id
    filename: str = ""  # 文件名字
    filepath: str = ""  # 会话工作目录中的位置；尚未放入工作目录时为空
    key: str = ""  # 内容对象位置
    extension: str = ""  # 扩展名
    mime_type: str = ""  # mime-type类型
    size: int = 0  # 文件大小，单位为字节
    sha256: str | None = None
    visual: dict | None = None  # 仅新建视觉产物的归属、输入规格与到期状态
    session_id: str | None = Field(default=None, exclude=True)  # 所属会话；上传后发送前为空
