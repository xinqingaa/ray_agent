"""工作区文件端口：在已登记的可访问根内读写，位置一律是 root_id 加相对路径。

实现先核对根身份再逐级访问，不跟随越界链接；平台特有的文件名限制、大小写冲突与原子替换由实现处理。
"""
from enum import StrEnum
from typing import Protocol

from pydantic import BaseModel, Field

from app.domain.models.error import ErrorCode, ResourceVersion
from app.domain.models.identity import ContentHash, RootedPath


class FileKind(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"
    SYMLINK = "symlink"  # 只报告链接文本，不当普通文件展开
    OTHER = "other"  # 设备、管道等特殊文件，不读写


class FileVersion(BaseModel):
    """写入前核对的版本；内容哈希按需计算。"""
    size: int = Field(ge=0)
    modified_ns: int
    content_hash: ContentHash | None = None


class FileEntry(BaseModel):
    path: RootedPath
    name: str
    kind: FileKind
    version: FileVersion | None = None  # 普通文件才有
    link_target: str | None = None  # 符号链接的目标文本


class DirectoryListing(BaseModel):
    path: RootedPath
    entries: list[FileEntry]
    truncated: bool = False


class WorkspaceFileError(Exception):
    """越界为 forbidden，根失联为 unavailable，版本不符为 conflict 并带当前版本。"""

    def __init__(self, code: ErrorCode, message: str, resource_version: ResourceVersion | None = None):
        super().__init__(message)
        self.code = code
        self.resource_version = resource_version


class WorkspaceFiles(Protocol):
    async def stat(self, path: RootedPath) -> FileEntry:
        ...

    async def list_dir(self, path: RootedPath, limit: int) -> DirectoryListing:
        ...

    async def read_bytes(self, path: RootedPath, offset: int = 0, length: int | None = None,
                         expected: FileVersion | None = None) -> bytes:
        """expected 不为空时，读取期间文件变化按冲突处理。"""
        ...

    async def write_bytes(self, path: RootedPath, data: bytes, expected: FileVersion | None) -> FileVersion:
        """expected 为空表示目标必须不存在；否则目标当前版本必须等于 expected。"""
        ...

    async def delete(self, path: RootedPath, expected: FileVersion) -> None:
        ...
