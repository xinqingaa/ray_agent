"""后台任务仓库。领取、进度与结果写回都按代次与实例所有者核对，迟到的写回返回 False 且不改动记录。"""
from typing import Any, Dict, List, Optional, Protocol, Sequence

from app.domain.models.background_job import BackgroundJob
from app.domain.models.error import ErrorInfo
from app.domain.models.operation import OperationKind, OperationStatus


class BackgroundJobRepository(Protocol):

    async def add(self, job: BackgroundJob) -> BackgroundJob:
        """登记任务；同类型同幂等键已存在时返回已有记录，不新建。"""
        ...

    async def get(self, job_id: str) -> Optional[BackgroundJob]:
        ...

    async def latest(self, kind: OperationKind, scope_kind: Optional[str] = None,
                     session_id: Optional[str] = None) -> Optional[BackgroundJob]:
        ...

    async def claim(self, owner: str, kinds: Sequence[OperationKind]) -> Optional[BackgroundJob]:
        """领取最早排队的一条任务：改为 running 并记录所有者。"""
        ...

    async def progress(self, job_id: str, generation: int, owner: str, *, phase: Optional[str] = None,
                       completed: Optional[int] = None, total: Optional[int] = None) -> bool:
        ...

    async def finish(self, job_id: str, generation: int, owner: str, status: OperationStatus, *,
                     result: Optional[Dict[str, Any]] = None, error: Optional[ErrorInfo] = None) -> bool:
        ...

    async def request_cancel(self, job_id: str) -> Optional[BackgroundJob]:
        """排队中的任务直接取消；运行中的任务只记取消请求。已结束时原样返回。"""
        ...

    async def retry(self, job_id: str) -> Optional[BackgroundJob]:
        """失败或取消的任务重新排队并递增代次；其他状态原样返回。"""
        ...

    async def running(self) -> List[BackgroundJob]:
        ...

    async def requeue(self, job_id: str) -> None:
        """重启接管：递增代次并重新排队。"""
        ...
