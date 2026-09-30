#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""本地项目的路径校验结果与文件浏览的返回结构。

宿主机项目目录以相同路径只读挂进 API 容器，文件树读这份挂载；沙箱里同一目录读写挂在 ``SANDBOX_PROJECT_DIR``。
时间字段与事件一致，用毫秒时间戳。
"""
from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

SANDBOX_PROJECT_DIR = "/workspace"

# 文件树每层默认不列出的名称（只按名称精确匹配）
DEFAULT_IGNORED_NAMES = frozenset({".git", "node_modules", ".venv", "__pycache__", ".next", ".DS_Store"})
TREE_ENTRY_LIMIT = 1000
FILE_READ_MAX_BYTES = 1024 * 1024
BINARY_SNIFF_BYTES = 8 * 1024


class PathCheckReason(str, Enum):
    """路径校验不通过的原因。"""
    NO_ROOTS = "no_roots"  # PROJECT_ROOTS 为空，功能关闭
    INVALID_PATH = "invalid_path"  # 空串、含 NUL、项目路径不是绝对路径，或项目内路径写成了绝对路径
    OUTSIDE_ROOTS = "outside_roots"  # realpath 不在任何允许根目录之内
    NOT_FOUND = "not_found"
    NOT_DIRECTORY = "not_directory"
    NOT_FILE = "not_file"  # 读文件时目标不是普通文件
    ESCAPES_PROJECT = "escapes_project"  # 项目内相对路径经 .. 或符号链接落到项目之外


PATH_CHECK_MESSAGES = {
    PathCheckReason.NO_ROOTS: "未配置允许接入的项目根目录（PROJECT_ROOTS）",
    PathCheckReason.INVALID_PATH: "路径格式不正确",
    PathCheckReason.OUTSIDE_ROOTS: "路径不在允许的项目根目录内",
    PathCheckReason.NOT_FOUND: "路径不存在",
    PathCheckReason.NOT_DIRECTORY: "路径不是目录",
    PathCheckReason.NOT_FILE: "路径不是普通文件",
    PathCheckReason.ESCAPES_PROJECT: "路径超出了项目目录",
}


class PathCheck(BaseModel):
    """一次路径校验的结果。通过时 ``real_path`` 是规范化的绝对路径（realpath）。"""
    ok: bool
    path: str  # 调用方给的原始路径
    real_path: Optional[str] = None  # 通过时为 realpath；未通过时尽量给出，便于日志
    root: Optional[str] = None  # 命中的允许根目录（realpath）
    relative: Optional[str] = None  # 项目内路径规范化后的 POSIX 形式，项目根为 ""
    reason: Optional[PathCheckReason] = None
    message: Optional[str] = None


class ProjectView(BaseModel):
    """会话对外的项目摘要。available 与 reason 每次请求按当前 PROJECT_ROOTS 实时计算，不入库。"""
    id: str
    path: str
    name: str
    available: bool
    archived: bool = False
    task_count: int = 0
    last_active_at: Optional[datetime] = None
    reason: Optional[str] = None  # 不可用时的中文说明；可用时为空


class ProjectPathError(Exception):
    """路径校验不通过。文件浏览在校验失败时抛出，由应用层转成 400/404。"""

    def __init__(self, check: PathCheck) -> None:
        self.check = check
        super().__init__(check.message or (check.reason.value if check.reason else "路径校验失败"))

    @property
    def reason(self) -> Optional[PathCheckReason]:
        return self.check.reason


class ProjectRoot(BaseModel):
    """配置中的一个允许根目录。"""
    configured: str  # PROJECT_ROOTS 里写的原值
    path: str  # realpath
    available: bool
    reason: Optional[PathCheckReason] = None  # not_found / not_directory


EntryType = Literal["file", "directory", "symlink", "other"]
LinkState = Literal["inside", "outside", "broken"]


class ProjectEntry(BaseModel):
    """文件树中的一个直接子项。

    符号链接指向项目内时 ``type`` 是目标的类型（可以展开或预览）；指向项目外或断链时 ``type`` 为 symlink，
    不跟随、不读取，``size`` 与 ``modified_at`` 取链接本身。
    """
    name: str
    path: str  # 相对项目根的 POSIX 路径，按请求路径拼接，不解析符号链接
    type: EntryType
    size: Optional[int] = None  # 只对文件给出
    modified_at: Optional[int] = None  # 毫秒
    is_symlink: bool = False
    link: Optional[LinkState] = None  # 仅符号链接


class ProjectListing(BaseModel):
    """某个项目目录的一层子项。"""
    path: str  # 相对项目根的 POSIX 路径，根为 ""
    entries: List[ProjectEntry] = Field(default_factory=list)
    total: int = 0  # 忽略名称过滤后的子项总数
    truncated: bool = False  # total 超过上限，只返回前 limit 条（目录在前，按名称排序）
    limit: int = TREE_ENTRY_LIMIT


FileKind = Literal["text", "binary", "too_large"]


class ProjectFile(BaseModel):
    """读文件的结果。二进制与超过上限的文件只有元数据，``content`` 为空。"""
    path: str
    name: str
    size: int
    modified_at: Optional[int] = None
    kind: FileKind
    content: Optional[str] = None  # UTF-8 解码，非法字节以替换字符显示
    max_bytes: int = FILE_READ_MAX_BYTES


class BrowseEntry(BaseModel):
    """根目录内某一层的一个子目录，供项目选择器逐层浏览。"""
    name: str
    path: str  # 绝对路径（父目录 realpath + 名称），绑定前仍要走路径校验
    is_symlink: bool = False


class BrowseListing(BaseModel):
    path: str  # 当前目录 realpath
    root: str  # 所在的允许根目录 realpath
    parent: Optional[str] = None  # 上一级，已经在根目录时为空
    entries: List[BrowseEntry] = Field(default_factory=list)
    total: int = 0
    truncated: bool = False
    limit: int = TREE_ENTRY_LIMIT
