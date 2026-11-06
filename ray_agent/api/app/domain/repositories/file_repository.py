#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Protocol, Optional

from app.domain.models.file import File


class FileRepository(Protocol):
    """文件模型数据仓库"""

    async def save(self, file: File) -> None:
        """新增或更新文件信息"""
        ...

    async def get_by_id(self, file_id: str) -> Optional[File]:
        """根据传递的文件id获取文件信息"""
        ...

    async def expired_visual_files(self, now: float, limit: int = 100) -> list[File]:
        """读取到期且尚未删除的新临时视觉产物。"""
        ...

    async def bind_session(self, file_ids: list[str], session_id: str) -> None:
        """把尚未归属的上传文件交给会话；已属于其他会话的文件不变。"""
        ...

    async def list_by_session(self, session_id: str) -> list[File]:
        ...

    async def list_all(self) -> list[File]:
        ...

    async def delete_all(self) -> None:
        ...
