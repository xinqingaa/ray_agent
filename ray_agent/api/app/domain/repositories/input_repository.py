"""持久输入与受理记录仓库：都在调用方的写事务内读写。"""
from typing import Collection, List, Optional, Protocol

from app.domain.models.run_input import AcceptedRequest, RunInput


class RunInputRepository(Protocol):

    async def add(self, run_input: RunInput) -> int:
        """写入一条待消费输入，返回输入身份。"""
        ...

    async def get(self, input_id: int) -> Optional[RunInput]:
        ...

    async def pending(self, run_id: str, exclude: Collection[int] = ()) -> List[RunInput]:
        """运行仍待消费的输入，按受理顺序。"""
        ...

    async def consume(self, input_ids: Collection[int], consumed_seq: int) -> int:
        """把仍待消费的输入标为已消费并记录上下文事件序号；返回实际变化的条数。"""
        ...

    async def unconsumed(self, session_id: str) -> List[RunInput]:
        """所属运行已结束但仍未消费的输入。"""
        ...

    async def reassign(self, input_id: int, run_id: str) -> None:
        """重新发起时把输入交给新运行。"""
        ...


class AcceptedRequestRepository(Protocol):

    async def get(self, request_id: str) -> Optional[AcceptedRequest]:
        ...

    async def add(self, request: AcceptedRequest) -> None:
        ...
