"""按当前实现上报能力：文件、命令与浏览器由 Docker 沙箱提供，检索、OCR 与远程控制尚未实现。"""
from typing import Awaitable, Callable

from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason

SANDBOX_CAPABILITIES = (Capability.FILE_ACCESS, Capability.LOCAL_COMMAND, Capability.BROWSER)
NOT_IMPLEMENTED = {
    Capability.FULL_TEXT_SEARCH: "工作区全文检索尚未实现",
    Capability.SEMANTIC_INDEX: "工作区语义索引尚未实现",
    Capability.OCR: "OCR 尚未实现",
    Capability.REMOTE_CONTROL: "远程控制尚未实现",
}


class CapabilityService:
    def __init__(self, sandbox_problem: Callable[[], Awaitable[str | None]]) -> None:
        """sandbox_problem 返回沙箱执行环境不可用的原因，可用时返回空。"""
        self._sandbox_problem = sandbox_problem

    async def current(self) -> list[CapabilityStatus]:
        problem = await self._sandbox_problem()
        statuses = [
            CapabilityStatus.available(capability, "由 Docker 沙箱提供") if problem is None
            else CapabilityStatus.unavailable(capability, UnavailableReason.DEPENDENCY_UNAVAILABLE, problem)
            for capability in SANDBOX_CAPABILITIES
        ]
        statuses += [CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED, detail)
                     for capability, detail in NOT_IMPLEMENTED.items()]
        return statuses
