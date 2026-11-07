"""写入租约仓库：写事务串行，「读取再插入」在同一事务内不会被其他取得者穿插；唯一索引兜底每工作区至多一个。"""
from typing import List, Optional, Protocol

from app.domain.models.write_lease import LeaseState, WriteLease


class WriteLeaseRepository(Protocol):

    async def get(self, workspace_id: str) -> Optional[WriteLease]:
        ...

    async def get_by_id(self, lease_id: str) -> Optional[WriteLease]:
        ...

    async def list(self) -> List[WriteLease]:
        ...

    async def add(self, lease: WriteLease) -> None:
        ...

    async def set_holds(self, lease_id: str, holds: int) -> None:
        ...

    async def set_state(self, lease_id: str, state: LeaseState, reason: Optional[str] = None) -> bool:
        """租约仍存在时改状态，返回是否生效。"""
        ...

    async def delete(self, lease_id: str) -> bool:
        ...

    async def delete_for_run(self, run_id: str) -> List[WriteLease]:
        """删除某个运行持有的全部租约，返回被删除的记录；身份按运行核对，不影响其他运行。"""
        ...

    async def foreign(self, instance_id: str) -> List[WriteLease]:
        """不属于当前核心启动的租约。"""
        ...

    async def delete_workspace(self, workspace_id: str) -> None:
        ...

    async def delete_all(self) -> None:
        ...
