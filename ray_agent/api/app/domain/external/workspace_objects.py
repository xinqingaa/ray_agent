"""工作区归属的内容对象端口：写前备份与撤销前备份。

对象按工作区归属，同一工作区内相同哈希只保存一份；不提供跨工作区的存在性查询。已被变更记录引用的对象
不单独删除，随工作区删除的清理任务回收。保存失败（含磁盘不足）时抛出 WorkspaceFileError，调用方据此不发布写入。
"""
from typing import BinaryIO, Protocol

from app.domain.models.file_change import WorkspaceObject


class WorkspaceObjects(Protocol):

    async def put(self, workspace_id: str, source: BinaryIO) -> WorkspaceObject:
        """流式保存并按内容哈希在工作区内去重；source 在线程里读取。"""
        ...

    async def read(self, obj: WorkspaceObject, offset: int = 0, length: int | None = None) -> bytes:
        ...

    async def open(self, obj: WorkspaceObject) -> BinaryIO:
        """打开只读流，调用方负责关闭并在线程里读取。"""
        ...
