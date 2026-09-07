#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/21 0:44
@Author  : thezehui@gmail.com
@File    : file_storage.py
"""
from typing import Protocol, Tuple, BinaryIO

from fastapi import UploadFile

from app.domain.models.file import File


class FileStorage(Protocol):
    """文件存储协议，由本地磁盘或对象存储实现"""

    async def upload_file(self, upload_file: UploadFile) -> File:
        """根据传递的文件源上传文件后返回文件信息"""
        ...

    async def download_file(self, file_id: str) -> Tuple[BinaryIO, File]:
        """根据传递的文件id下载文件，并返回文件源+文件信息"""
        ...

    def get_file_url(self, file: File) -> str:
        """返回可供页面访问的文件地址"""
        ...
