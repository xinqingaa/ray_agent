"""Agent 循环测试夹具：保留真实 AgentLoop、工具管线与运行器，替换模型、存储、传输与沙箱。"""
import json
from types import SimpleNamespace
from typing import Any, Awaitable, Callable, Dict, List, Optional
from unittest.mock import AsyncMock

from app.domain.models.app_config import AgentConfig
from app.domain.models.event import MessageEvent
from app.domain.models.memory import Memory
from app.domain.models.session import Session
from app.domain.models.token_usage import TokenUsageTotals
from app.domain.models.tool_result import ToolResult
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME, AgentLoop
from app.domain.services.tools.base import BaseTool, tool
from app.domain.services.tools.file import FileTool
from app.domain.services.tools.message import MessageTool
from tests.support.scripted_llm import ScriptedLLM, ScriptItem

Hook = Callable[[str], Awaitable[None]]


class RecordingTool(BaseTool):
    """记录调用顺序的测试工具；hook 在 echo 返回前执行，用于注入消息或阻塞。"""
    name = "recording"

    def __init__(self) -> None:
        super().__init__()
        self.calls: List[str] = []
        self.hook: Optional[Hook] = None

    @tool(name="echo", description="回显文本", parameters={"text": {"type": "string", "description": "文本"}},
          required=["text"])
    async def echo(self, text: str) -> ToolResult:
        self.calls.append(f"echo:{text}")
        if self.hook:
            await self.hook(text)
        return ToolResult(success=True, data={"echo": text})

    @tool(name="boom", description="总是抛出异常", parameters={}, required=[])
    async def boom(self) -> ToolResult:
        self.calls.append("boom")
        raise RuntimeError("受控异常")


class FakeSessionRepository:
    """只保留循环与运行器用到的会话仓库契约。"""

    def __init__(self, session: Session) -> None:
        self.s = session
        self.update_title = AsyncMock()
        self.update_latest_message = AsyncMock()
        self.increment_unread_message_count = AsyncMock()

    async def get_by_id(self, session_id):
        return self.s

    async def update_status(self, session_id, status):
        self.s.status = status

    async def get_memory(self, session_id, name):
        return self.s.memories.get(name, Memory()).model_copy(deep=True)

    async def save_memory(self, session_id, name, memory):
        self.s.memories[name] = memory.model_copy(deep=True)

    async def add_event(self, session_id, event):
        self.s.events.append(event.model_copy(deep=True))

    async def add_file(self, session_id, file):
        self.s.files.append(file)

    async def remove_file(self, session_id, file_id):
        self.s.files = [f for f in self.s.files if f.id != file_id]

    async def get_file_by_path(self, session_id, filepath):
        return next((f for f in self.s.files if f.filepath == filepath), None)


def make_uow_factory(session: Session):
    repository = FakeSessionRepository(session)

    class FakeUow:
        def __init__(self):
            self.session = repository

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    return FakeUow


def make_sandbox():
    return SimpleNamespace(read_file=AsyncMock(
        return_value=ToolResult(success=True, data={"content": "fixture observation"}),
    ))


def make_loop(script: List[ScriptItem], *, session: Optional[Session] = None, deliver_file=None,
              max_iterations: int = 10, max_retries: int = 2, sandbox=None) -> SimpleNamespace:
    session = session if session is not None else Session(id="w1-loop")
    sandbox = sandbox if sandbox is not None else make_sandbox()
    llm = ScriptedLLM(script)
    recording = RecordingTool()
    loop = AgentLoop(
        uow_factory=make_uow_factory(session),
        llm=llm,
        agent_config=AgentConfig(max_iterations=max_iterations, max_retries=max_retries),
        session_id=session.id,
        tools=[FileTool(sandbox=sandbox), MessageTool(), recording],
        deliver_file=deliver_file,
        retry_interval=0,
    )
    return SimpleNamespace(loop=loop, llm=llm, session=session, sandbox=sandbox, recording=recording)


def memory_messages(session: Session) -> List[Dict[str, Any]]:
    memory = session.memories.get(AGENT_MEMORY_NAME)
    return memory.messages if memory else []


def tool_results(messages: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """tool_call_id → 解析后的 ToolResult 字典。"""
    return {m["tool_call_id"]: json.loads(m["content"]) for m in messages if m.get("role") == "tool"}


def assert_no_dangling(messages: List[Dict[str, Any]]) -> None:
    """每个助手工具调用在下一条助手消息之前都有配对结果。"""
    pending: List[str] = []
    for message in messages:
        if message.get("role") == "assistant":
            assert not pending, f"悬空调用：{pending}"
            pending = [call["id"] for call in message.get("tool_calls") or []]
        elif message.get("role") == "tool":
            assert message["tool_call_id"] in pending, f"未配对的结果：{message['tool_call_id']}"
            pending.remove(message["tool_call_id"])
    assert not pending, f"悬空调用：{pending}"


# ---------------- 运行器夹具 ----------------

class MemoryQueue:
    """只替换传输，不模拟 Redis 锁与多进程。"""

    def __init__(self, name=""):
        self.items, self.history, self.on_put = [], [], None

    async def put(self, value):
        key = str(len(self.history) + 1)
        self.items.append((key, value))
        self.history.append(value)
        if self.on_put:
            await self.on_put(value)
        return key

    async def pop(self):
        return self.items.pop(0) if self.items else (None, None)

    async def is_empty(self):
        return not self.items


def make_runner(h: SimpleNamespace) -> AgentTaskRunner:
    """用 make_loop 的结果组装运行器；附件同步与工具展示内容不属于这些实验。"""
    r = AgentTaskRunner.__new__(AgentTaskRunner)
    r._session_id, r._uow_factory, r._flow = h.session.id, h.loop._uow_factory, h.loop
    r._uow, r._sandbox = r._uow_factory(), h.sandbox
    r._sandbox.ensure_sandbox, r._sandbox.destroy = AsyncMock(), AsyncMock()
    r._mcp_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._a2a_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._token_totals = TokenUsageTotals()
    r._sync_message_attachments_to_sandbox = AsyncMock()
    r._handle_tool_event = AsyncMock()
    return r


def input_task() -> SimpleNamespace:
    return SimpleNamespace(input_stream=MemoryQueue(), output_stream=MemoryQueue())


async def submit(task, text: str) -> None:
    await task.input_stream.put(MessageEvent(role="user", message=text).model_dump_json())
