"""文件夹级访问：绑定前的检查、身份核对、新建文件夹与 `.rayagent/workspace.json` 标记。

与 WorkspaceFiles 不同，这里的路径是调用方已验证来源的规范绝对路径（桌面原生选择凭证或默认位置），不经过 root_id。
标记只追加或更新本机安装身份的条目，不改写其他条目。
"""
from typing import Protocol

from app.domain.external.workspace_files import ScanSummary
from app.domain.models.workspace import FolderInspection


class FolderAccess(Protocol):
    async def inspect(self, path: str) -> FolderInspection:
        """解析规范路径与文件系统身份并读取标记；路径不是目录时抛 WorkspaceFileError。"""
        ...

    async def scan(self, path: str, dev: int, ino: int) -> ScanSummary:
        ...

    async def matches(self, path: str, dev: int, ino: int) -> bool:
        """路径存在、是目录且文件系统身份与登记一致；不存在、不是目录或身份不符为假，无法判断的错误（权限、描述符耗尽）抛出。"""
        ...

    async def sweep_temp(self, path: str, dev: int, ino: int, max_age_seconds: float) -> int:
        """清理文件夹里崩溃残留的写入临时文件（只处理应用命名规则且超过期限的），返回数量。"""
        ...

    async def exists(self, path: str) -> bool:
        """路径存在且是目录，不核对身份。"""
        ...

    async def create_folder(self, parent: str, name: str) -> str:
        """在 parent 下新建名为 name 的文件夹，重名则加序号，不复用已存在的目录；返回规范路径。"""
        ...

    async def remove_empty_folder(self, path: str) -> None:
        ...

    async def write_marker(self, path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> None:
        """追加或更新本机条目；失败抛 WorkspaceFileError，由调用方标出标记不可写。"""
        ...

    async def remove_marker(self, path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> bool:
        """移除本机条目（仅当它仍指向该工作区）；返回是否已不含该条目。文件夹失联或写入失败时为假。"""
        ...
