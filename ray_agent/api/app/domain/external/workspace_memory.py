"""模型工具使用的工作区记忆端口。

工作区、会话与运行身份在构造端口时由服务端从会话解析，端口方法没有工作区参数：
模型无法指定、也无法切换到另一个工作区。
"""
from typing import Any, Optional, Protocol, Sequence


class WorkspaceMemoryPort(Protocol):

    async def remember(self, content: str, memory_type: str) -> dict[str, Any]:
        """用户要求下写入一条记忆；立即生效，标为材料陈述。失败抛出异常，不得当作已记住。"""
        ...

    async def forget(self, memory_id: str) -> dict[str, Any]:
        """用户要求下撤回本工作区的一条记忆。"""
        ...

    async def list_memories(self, status: str, limit: int) -> list[dict[str, Any]]:
        """列出本工作区的记忆（活动或候选）。"""
        ...

    async def search(self, query: str, source_types: Optional[Sequence[str]]) -> list[dict[str, Any]]:
        """在本工作区检索记忆、会话摘要与文件片段。"""
        ...

    async def read_source(self, source_id: str) -> Optional[dict[str, Any]]:
        """按检索命中的 source_id 读回文件片段原文与定位；不存在或已撤回时为空。"""
        ...

    async def propose_working_style(self, body: str, rationale: str) -> dict[str, Any]:
        """提议新的工作方式草案；需用户确认才生效。"""
        ...
