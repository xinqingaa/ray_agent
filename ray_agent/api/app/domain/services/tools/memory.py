"""工作区记忆工具：记住、遗忘、列出、检索与工作方式提议。

三个工具集都只持有端口，端口已绑定会话所属的工作区；参数里没有工作区身份。独立对话不装配这些工具。
写入失败时返回失败结果，措辞不得让模型把未成功的写入说成已记住。
"""
import logging
from typing import Optional

from app.domain.external.workspace_memory import WorkspaceMemoryPort
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool

logger = logging.getLogger(__name__)

MEMORY_TYPES = ["fact", "preference", "decision", "constraint"]
LIST_STATUSES = ["active", "candidate"]


def _failure(error: Exception, action: str) -> ToolResult:
    info = getattr(error, "info", None)  # 应用层异常携带结构化错误，直接取给用户看的原因
    message = info.message if info is not None else str(error) or type(error).__name__
    logger.info("工作区记忆工具失败 action=%s: %s", action, message)
    return ToolResult(success=False, message=f"{action}失败，未写入任何内容：{message}")


class MemoryTool(BaseTool):
    """记忆工具集：只在用户明确要求记住或忘掉某事时使用。"""
    name: str = "memory"

    def __init__(self, port: Optional[WorkspaceMemoryPort]) -> None:
        super().__init__()
        self.port = port

    @tool(
        name="memory_remember",
        description="用户明确要求记住某件事（事实、偏好、决定或约束）时，把它写入当前工作区的长期记忆，立即生效。"
                    "不要为自己的推断或对话中的普通信息调用；自动沉淀由系统另行处理。成功后才能告诉用户已记住。",
        parameters={
            "content": {"type": "string", "description": "要记住的内容，一条完整、自足的陈述，不超过 2000 字符"},
            "memory_type": {"type": "string", "enum": MEMORY_TYPES,
                            "description": "类型：fact 事实、preference 偏好、decision 决定、constraint 约束；默认 fact"},
        },
        required=["content"],
    )
    async def memory_remember(self, content: str, memory_type: str = "fact") -> ToolResult:
        try:
            entry = await self.port.remember(content, memory_type or "fact")
        except Exception as error:
            return _failure(error, "记住")
        return ToolResult(success=True, message=f"已记住（{entry['memory_type']}）：{entry['content']}", data=entry)

    @tool(
        name="memory_forget",
        description="用户明确要求忘掉某条记忆时撤回它。先用 memory_list 或 knowledge_search 找到条目 id；撤回后不再参与注入与检索，用户可在界面撤销。",
        parameters={"memory_id": {"type": "string", "description": "要撤回的记忆条目 id"}},
        required=["memory_id"],
    )
    async def memory_forget(self, memory_id: str) -> ToolResult:
        try:
            entry = await self.port.forget(memory_id)
        except Exception as error:
            return _failure(error, "撤回")
        return ToolResult(success=True, message=f"已撤回：{entry['content']}", data=entry)

    @tool(
        name="memory_list",
        description="列出当前工作区的记忆条目（含 id、类型、确定性），用于核对已记住的内容或找到要撤回的条目。",
        parameters={
            "status": {"type": "string", "enum": LIST_STATUSES,
                       "description": "active 活动条目（默认）；candidate 等待用户确认的候选"},
        },
        required=[],
    )
    async def memory_list(self, status: str = "active") -> ToolResult:
        try:
            items = await self.port.list_memories(status or "active", 50)
        except Exception as error:
            return _failure(error, "列出记忆")
        return ToolResult(success=True, message=f"共 {len(items)} 条", data={"memories": items})


class KnowledgeSearchTool(BaseTool):
    """检索工具集：范围固定为本工作区的记忆、会话摘要与文件片段。"""
    name: str = "knowledge"

    def __init__(self, port: Optional[WorkspaceMemoryPort]) -> None:
        super().__init__()
        self.port = port

    @tool(
        name="knowledge_search",
        description="在当前工作区的记忆、其他对话的摘要与已索引文件片段中全文检索。"
                    "需要回忆约定、决定、相关对话或文件夹材料时使用；结果带来源类型与定位，"
                    "model_inferred 为模型推断、未经用户确认，只作参考。读回某条文件原文用 knowledge_read。",
        parameters={
            "query": {"type": "string", "description": "检索词或短语，提取核心关键词"},
            "source_types": {
                "type": "array",
                "items": {"type": "string", "enum": ["memory", "session_summary", "document_chunk"]},
                "description": "（可选）限定来源；默认三类都查",
            },
        },
        required=["query"],
    )
    async def knowledge_search(self, query: str, source_types: Optional[list[str]] = None) -> ToolResult:
        try:
            hits = await self.port.search(query, source_types)
        except Exception as error:
            return _failure(error, "检索")
        return ToolResult(success=True, message=f"命中 {len(hits)} 条" if hits else "没有命中", data={"hits": hits})

    @tool(
        name="knowledge_read",
        description="按 knowledge_search 返回的文件片段 source_id 读回原文与定位（页、块、行列等）。"
                    "只能读当前工作区已发布的片段；版本已过期时结果会标明 stale。",
        parameters={
            "source_id": {"type": "string", "description": "检索命中的 source_id（文件片段 id）"},
        },
        required=["source_id"],
    )
    async def knowledge_read(self, source_id: str) -> ToolResult:
        try:
            item = await self.port.read_source(source_id)
        except Exception as error:
            return _failure(error, "读取来源")
        if item is None:
            return ToolResult(success=False, message="来源不存在、已撤回或不属于当前工作区")
        return ToolResult(success=True, message="已读回原文", data=item)


class InstructionProposalTool(BaseTool):
    """工作方式提议：用户在对话里表达长期要求时，生成新版本草案交用户确认。"""
    name: str = "working_style"

    def __init__(self, port: Optional[WorkspaceMemoryPort]) -> None:
        super().__init__()
        self.port = port

    @tool(
        name="propose_working_style",
        description="用户在对话中表达了对这个工作区长期有效的角色、做事原则或禁止事项时，提议新的工作方式全文。"
                    "提议只生成待确认的草案，用户确认前不生效、也不影响当前运行；不要声称已经生效。"
                    "body 是修改后的完整工作方式（不是差异），应保留原有仍然适用的内容。",
        parameters={
            "body": {"type": "string", "description": "新工作方式的完整正文，不超过 4000 字符"},
            "rationale": {"type": "string", "description": "（可选）一句话说明为什么要这样修改"},
        },
        required=["body"],
    )
    async def propose_working_style(self, body: str, rationale: str = "") -> ToolResult:
        try:
            proposal = await self.port.propose_working_style(body, rationale or "")
        except Exception as error:
            return _failure(error, "提议")
        return ToolResult(success=True, message="已生成待用户确认的工作方式草案，确认前不会生效。", data=proposal)


def workspace_toolkits(port: WorkspaceMemoryPort) -> list[BaseTool]:
    return [MemoryTool(port), KnowledgeSearchTool(port), InstructionProposalTool(port)]

