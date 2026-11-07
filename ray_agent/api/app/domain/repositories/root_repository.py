"""可访问根登记：会话工作目录与会话同事务创建，位置是相对数据根的路径；工作区文件夹登记规范路径与文件系统身份。"""
from datetime import datetime
from typing import Optional, Protocol, Tuple

from app.domain.models.identity import RootRef
from app.domain.models.workspace import FolderStatus, RootRecord


class RootRepository(Protocol):

    async def add(self, root: RootRef, location: str, *, dev: Optional[int] = None, ino: Optional[int] = None,
                  marker_writable: bool = True) -> None:
        ...

    async def session_workdir(self, session_id: str) -> Optional[Tuple[RootRef, str]]:
        """会话工作目录根与其位置；没有登记时为空。"""
        ...

    async def get(self, root_id: str) -> Optional[RootRecord]:
        ...

    async def workspace_folder(self, workspace_id: str) -> Optional[RootRecord]:
        ...

    async def workspace_folders(self) -> list[RootRecord]:
        """所有工作区文件夹根，用于检查嵌套与按文件系统身份识别。"""
        ...

    async def rebind_folder(self, root_id: str, *, location: str, dev: int, ino: int, marker_writable: bool,
                            checked_at: datetime) -> None:
        """同一个根改指到新的文件夹；root_id 不变，已记录的文件位置继续有效。"""
        ...

    async def set_folder_state(self, root_id: str, status: FolderStatus, checked_at: datetime) -> None:
        ...

    async def remove(self, root_id: str) -> None:
        ...
