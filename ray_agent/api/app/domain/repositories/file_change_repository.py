"""文件变更记录与工作区备份对象仓库。"""
from typing import Optional, Protocol

from app.domain.models.file_change import FileChange, RunChangeRow, WorkspaceObject


class FileChangeRepository(Protocol):

    async def add(self, change: FileChange) -> FileChange:
        ...

    async def for_run(self, workspace_id: str, run_id: str) -> list[FileChange]:
        """按写入顺序。"""
        ...

    async def runs(self, workspace_id: str, limit: int) -> list[RunChangeRow]:
        """有变更记录的运行，最近修改的在前；撤销操作以自己的操作身份列出（undo_of_run_id 非空）；不含没有归属的上传。"""
        ...

    async def object_by_hash(self, workspace_id: str, sha256: str) -> Optional[WorkspaceObject]:
        ...

    async def add_object(self, obj: WorkspaceObject) -> None:
        ...

    async def get_objects(self, workspace_id: str, object_ids: list[str]) -> dict[str, WorkspaceObject]:
        ...

    async def delete_workspace(self, workspace_id: str) -> list[str]:
        """删除工作区的全部变更记录与备份对象记录，返回需要回收的内容对象位置。"""
        ...

    async def delete_all(self) -> list[str]:
        ...
