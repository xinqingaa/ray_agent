"""可访问根登记：会话工作目录与会话同事务创建，位置是相对数据根的路径。"""
from typing import Optional, Protocol, Tuple

from app.domain.models.identity import RootRef


class RootRepository(Protocol):

    async def add(self, root: RootRef, location: str) -> None:
        ...

    async def session_workdir(self, session_id: str) -> Optional[Tuple[RootRef, str]]:
        """会话工作目录根与其位置；没有登记时为空。"""
        ...
