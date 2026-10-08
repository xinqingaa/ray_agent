#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid

from pydantic import BaseModel, Field


class File(BaseModel):
    """文件信息Domain模型，用于记录Manus/Human上传or生成的文件"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 文件id
    filename: str = ""  # 文件名字
    filepath: str = ""  # 文件路径
    key: str = ""  # 存储中的对象路径
    extension: str = ""  # 扩展名
    mime_type: str = ""  # mime-type类型
    size: int = 0  # 文件大小，单位为字节
    sha256: str | None = None
    visual: dict | None = None  # 仅新建视觉产物的归属、输入规格与到期状态
    project_upload: dict | None = None
    project_persistence: dict | None = None  # 事件中的交付状态；全局文件表不保存此投影
