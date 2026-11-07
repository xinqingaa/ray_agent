"""工作区文件端口：在已登记的可访问根内读写，位置一律是 root_id 加相对路径。

实现先核对根身份再逐级访问，不跟随任何符号链接；平台特有的文件名限制、大小写冲突与原子替换由实现处理。
工作区文件夹根与会话工作目录根共用同一实现。
"""
from dataclasses import dataclass
from enum import StrEnum
from typing import BinaryIO, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.error import ErrorCode, ResourceVersion
from app.domain.models.identity import ContentHash, RootedPath, RootId, RootKind


class FileKind(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"
    SYMLINK = "symlink"  # 只报告链接文本，不当普通文件展开
    OTHER = "other"  # 设备、管道等特殊文件，不读写


class FileVersion(BaseModel):
    """写入前核对的版本；内容哈希按需计算，期望版本带哈希时一并核对。"""
    size: int = Field(ge=0)
    modified_ns: int
    content_hash: ContentHash | None = None


class FileEntry(BaseModel):
    path: RootedPath
    name: str
    kind: FileKind
    version: FileVersion | None = None  # 普通文件才有
    link_target: str | None = None  # 符号链接的目标文本
    inode: int | None = None  # 同一文件被替换成另一个文件时变化，参与预览缓存的版本判断


class DirectoryListing(BaseModel):
    path: RootedPath
    entries: list[FileEntry]
    truncated: bool = False


class ScanSummary(BaseModel):
    """文件夹规模：排除规则之外的文件数与总大小；达到扫描上限时截断。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    files: int = 0
    directories: int = 0
    bytes: int = 0
    truncated: bool = False


@dataclass
class FolderSnapshot:
    """排除规则之外的普通文件在某一刻的 (大小, 修改时间)，键是相对路径；达到扫描上限时 truncated 为真。"""
    files: dict[str, tuple[int, int]]
    truncated: bool = False


class RootBinding(BaseModel):
    """一个可访问根在本机的实际位置与登记的文件系统身份；身份为空的根（会话工作目录）不核对身份。"""
    root_id: RootId
    kind: RootKind
    path: str = Field(description="规范绝对路径")
    dev: int | None = None
    ino: int | None = None


@dataclass(frozen=True)
class FileLimits:
    """文件 IO 的可调上限；默认值见运行参数页，核心从系统配置构造。"""
    read_bytes: int = 4 * 1024 * 1024  # 单次读取的字节上限
    list_entries: int = 2000  # 单个目录的列举条数上限
    scan_entries: int = 50_000  # 扫描访问的文件与目录总数上限
    scan_depth: int = 32  # 扫描深度上限
    write_bytes: int = 2 * 1024 * 1024 * 1024  # 单个文件写入的字节上限
    search_matches: int = 200  # 单个文件内搜索返回的匹配行数上限
    find_results: int = 500  # 目录树内按名称查找返回的条数上限
    find_entries: int = 20_000  # 按名称查找访问的条目总数上限


class WorkspaceFileError(Exception):
    """越界为 forbidden，根失联为 unavailable，版本不符或名称冲突为 conflict 并带当前版本。"""

    def __init__(self, code: ErrorCode, message: str, resource_version: ResourceVersion | None = None,
                 current: FileVersion | None = None, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.resource_version = resource_version
        self.current = current  # 冲突时目标当前的版本；目标不存在时为空
        self.details = details or {}  # 写入租约被占用时带占用者与原因


class WorkspaceFiles(Protocol):
    async def stat(self, path: RootedPath, *, with_hash: bool = False) -> FileEntry:
        ...

    async def list_dir(self, path: RootedPath, limit: int | None = None) -> DirectoryListing:
        """按排除规则过滤；超过上限时 truncated 为真。"""
        ...

    async def read_bytes(self, path: RootedPath, offset: int = 0, length: int | None = None,
                         expected: FileVersion | None = None) -> bytes:
        """length 为空读到读取上限；expected 不为空时，读取期间文件变化按冲突处理。"""
        ...

    async def open_reader(self, path: RootedPath, expected: FileVersion | None = None) -> BinaryIO:
        """打开普通文件的只读流，调用方负责关闭并在线程里读取；合法大文件靠它流式读取。"""
        ...

    async def write_bytes(self, path: RootedPath, data: bytes, expected: FileVersion | None) -> FileVersion:
        """expected 为空表示目标必须不存在；否则目标当前版本必须等于 expected。"""
        ...

    async def write_stream(self, path: RootedPath, source: BinaryIO, expected: FileVersion | None) -> FileVersion:
        """同 write_bytes，内容来自流；先写同目录临时文件，发布前再次核对目标。"""
        ...

    async def mkdir(self, path: RootedPath, parents: bool = True) -> FileEntry:
        ...

    async def move(self, source: RootedPath, target: RootedPath, expected: FileVersion | None = None) -> FileEntry:
        """目标必须不存在，不覆盖；源是普通文件时 expected 不为空则核对其版本。"""
        ...

    async def delete(self, path: RootedPath, expected: FileVersion) -> None:
        ...

    async def scan(self, path: RootedPath) -> ScanSummary:
        ...

    async def snapshot(self, path: RootedPath) -> FolderSnapshot:
        """目录树的文件快照，规模受扫描上限约束；用于定期重扫发现外部变更。"""
        ...
