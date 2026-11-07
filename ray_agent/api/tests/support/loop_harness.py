"""Agent 循环测试夹具：保留真实 AgentLoop、工具管线与运行器，替换模型、存储与传输；文件工具使用真实的临时目录。"""
import asyncio
import json
from types import SimpleNamespace
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence
from unittest.mock import AsyncMock

from app.domain.models.app_config import AgentConfig, ToolPolicyConfig
from pydantic import TypeAdapter

from app.domain.external.event_notifier import OutputDelta
from app.domain.models.event import BaseEvent, Event, MessageEvent
from app.domain.models.memory import Memory
from app.domain.models.run import ACTIVE_RUN_STATUSES, Run, RunStatus
from app.domain.models.run_input import RunInput, RunInputStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.run_repository import ActiveRunExistsError
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.run_ledger import RunLedger
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
        self.recent_summaries = AsyncMock(return_value=[])
        self.update_title = AsyncMock()
        self.update_latest_message = AsyncMock()
        self.increment_unread_message_count = AsyncMock()
        self.update_unread_message_count = AsyncMock()

    async def get_by_id(self, session_id):
        return self.s

    lock = get_by_id

    async def save(self, session):
        pass

    async def set_title(self, session_id, title, source, expected_source=None):
        if expected_source is not None and self.s.title_source != expected_source:
            return False
        self.s.title, self.s.title_source = title, source
        return True

    async def update_status(self, session_id, status):
        self.s.status = status

    async def get_memory(self, session_id, name):
        return self.s.memories.get(name, Memory()).model_copy(deep=True)

    async def save_memory(self, session_id, name, memory):
        self.s.memories[name] = memory.model_copy(deep=True)

    async def add_file(self, session_id, file):
        self.s.files.append(file)

    async def remove_file(self, session_id, file_id):
        self.s.files = [f for f in self.s.files if f.id != file_id]

    async def get_file_by_path(self, session_id, filepath):
        return next((f for f in reversed(self.s.files) if f.filepath == filepath), None)


_EVENT = TypeAdapter(Event)


class FakeEventRepository:
    """内存事件表：seq 按会话递增；保存经 JSON 往返的副本，模拟落库后再读出。"""

    def __init__(self, events: List[BaseEvent]) -> None:
        self.events = events

    async def add(self, session_id, event):
        event.seq = len(self.events) + 1
        self.events.append(_EVENT.validate_json(event.model_dump_json()))
        return event.seq

    async def get(self, session_id, seq):
        found = next((e for e in self.events if e.seq == seq), None)
        return found.model_copy(deep=True) if found else None

    async def list(self, session_id, after_seq=0, limit=None, types=None, run_id=None):
        found = [e.model_copy(deep=True) for e in self.events
                 if e.seq > after_seq and (not types or e.type in types) and (run_id is None or e.run_id == run_id)]
        return found[:limit] if limit is not None else found

    async def max_seq(self, session_id):
        return len(self.events)


class FakeRunRepository:
    """内存运行表：保留“每会话至多一个活动运行”与“终态不可改”两条约束。"""

    def __init__(self, runs: Dict[str, Run]) -> None:
        self.runs = runs

    async def create(self, run):
        if any(r.session_id == run.session_id and r.status in ACTIVE_RUN_STATUSES for r in self.runs.values()):
            raise ActiveRunExistsError(run.session_id)
        self.runs[run.id] = run.model_copy(deep=True)

    async def get(self, run_id):
        run = self.runs.get(run_id)
        return run.model_copy(deep=True) if run else None

    lock = get

    async def get_active(self, session_id):
        return next((r.model_copy(deep=True) for r in self.runs.values()
                     if r.session_id == session_id and r.status in ACTIVE_RUN_STATUSES), None)

    async def list_by_session(self, session_id):
        return [r.model_copy(deep=True) for r in self.runs.values() if r.session_id == session_id]

    async def list_by_status(self, status):
        return [r.model_copy(deep=True) for r in self.runs.values() if r.status == status]

    async def transition(self, run_id, status, reason=None, ended_at=None):
        run = self.runs.get(run_id)
        if run is None or run.status.terminal:
            return None
        run.status, run.reason, run.ended_at = status, reason, ended_at
        return run.model_copy(deep=True)

    async def add_counters(self, run_id, turns=0, model_requests=0, tool_calls=0, prompt_tokens=0,
                           completion_tokens=0, cached_tokens=None):
        run = self.runs[run_id]
        run.turns += turns
        run.model_requests += model_requests
        run.tool_calls += tool_calls
        run.prompt_tokens += prompt_tokens
        run.completion_tokens += completion_tokens
        if cached_tokens is not None:
            run.cached_tokens = (run.cached_tokens or 0) + cached_tokens

    async def save_snapshot(self, run_id, snapshot):
        self.runs[run_id].config_snapshot = json.loads(json.dumps(snapshot))


class FakeRunInputRepository:
    """内存持久输入：保留受理顺序、按运行取待消费输入与只消费一次的约束。"""

    def __init__(self, inputs: List[RunInput]) -> None:
        self.inputs = inputs

    async def add(self, run_input):
        run_input.id = len(self.inputs) + 1
        self.inputs.append(run_input.model_copy(deep=True))
        return run_input.id

    async def get(self, input_id):
        found = next((item for item in self.inputs if item.id == input_id), None)
        return found.model_copy(deep=True) if found else None

    async def pending(self, run_id, exclude=()):
        return [item.model_copy(deep=True) for item in self.inputs
                if item.run_id == run_id and item.status == RunInputStatus.PENDING and item.id not in exclude]

    async def consume(self, input_ids, consumed_seq):
        changed = 0
        for item in self.inputs:
            if item.id in input_ids and item.status == RunInputStatus.PENDING:
                item.status, item.consumed_seq, changed = RunInputStatus.CONSUMED, consumed_seq, changed + 1
        return changed

    async def reassign(self, input_id, run_id):
        for item in self.inputs:
            if item.id == input_id:
                item.run_id = run_id


class Store:
    """一个会话的全部内存状态；同一 Session 对象的多个夹具共享同一份。"""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.events: List[BaseEvent] = []
        self.runs: Dict[str, Run] = {}
        self.inputs: List[RunInput] = []


_STORES: Dict[int, Store] = {}


def store_of(session: Session) -> Store:
    store = _STORES.get(id(session))
    if store is None or store.session is not session:
        store = _STORES[id(session)] = Store(session)
    return store


def restore_session(session: Session) -> Session:
    """模拟从数据库重新读出：会话经 JSON 往返得到新对象，事件与运行表按副本共享给新对象。"""
    restored = Session.model_validate_json(session.model_dump_json())
    old, new = store_of(session), store_of(restored)
    new.events.extend(e.model_copy(deep=True) for e in old.events)
    new.runs.update({k: v.model_copy(deep=True) for k, v in old.runs.items()})
    new.inputs.extend(i.model_copy(deep=True) for i in old.inputs)
    return restored


def make_uow_factory(session: Session):
    store = store_of(session)
    repository = FakeSessionRepository(session)

    class FakeUow:
        def __init__(self):
            self.session = repository
            self.event = FakeEventRepository(store.events)
            self.run = FakeRunRepository(store.runs)
            self.run_input = FakeRunInputRepository(store.inputs)
            self.request = SimpleNamespace(get=AsyncMock(return_value=None), add=AsyncMock())
            self.root = SimpleNamespace(session_workdir=AsyncMock(return_value=None))
            self.file = SimpleNamespace(get_by_id=AsyncMock(return_value=None), save=AsyncMock(),
                                        bind_session=AsyncMock())

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def commit(self):
            pass

        async def rollback(self):
            pass

    FakeUow.store = store
    return FakeUow


class MemoryNotifier:
    """内存通知：记录发布的 seq；drop=True 时丢弃通知，用来验证兜底查询。on_publish 在提交后被调用。"""

    def __init__(self) -> None:
        self.published: List[int] = []
        self.deltas: List[OutputDelta] = []
        self.drop = False
        self.on_publish: Optional[Callable[[int], Awaitable[None]]] = None
        self._queues: List[asyncio.Queue] = []

    async def publish(self, session_id, seq):
        self.published.append(seq)
        if self.on_publish:
            await self.on_publish(seq)
        if self.drop:
            return
        for queue in list(self._queues):
            queue.put_nowait(seq)

    async def publish_delta(self, session_id, run_id, turn, attempt, delta):
        notice = OutputDelta(session_id=session_id, run_id=run_id, turn=turn, attempt=attempt, delta=delta)
        self.deltas.append(notice)
        if self.drop:
            return
        for queue in list(self._queues):
            queue.put_nowait(notice)

    async def subscribe(self, session_id):
        queue: asyncio.Queue = asyncio.Queue()
        self._queues.append(queue)
        notifier = self

        class Subscription:
            async def get(self, timeout):
                try:
                    return await asyncio.wait_for(queue.get(), timeout)
                except asyncio.TimeoutError:
                    return None

            async def close(self):
                if queue in notifier._queues:
                    notifier._queues.remove(queue)

        return Subscription()


class RecordingFiles:
    """包住真实的根内文件实现，记录读写调用；断言“没有读过/写过某文件”时看 calls。"""
    RECORDED = ("stat", "list_dir", "read_bytes", "open_reader", "write_bytes", "write_stream", "mkdir", "move",
                "delete")

    def __init__(self, inner) -> None:
        self._inner = inner
        self.calls: list = []

    def __getattr__(self, name):
        attribute = getattr(self._inner, name)
        if name not in self.RECORDED:
            return attribute

        async def recorded(path, *args, **kwargs):
            self.calls.append((name, path.relative_path))
            return await attribute(path, *args, **kwargs)
        return recorded

    def wrote(self) -> list:
        return [call for call in self.calls if call[0] in ("write_bytes", "write_stream", "mkdir", "move", "delete")]

    def read(self) -> list:
        return [call for call in self.calls if call[0] in ("read_bytes", "open_reader")]


class FileFixture:
    """一个真实的临时目录作为工作目录根：循环里的文件工具走真实实现，测试用相对路径（相对工作目录）。"""

    def __init__(self, files: Optional[Dict[str, Any]] = None, root=None) -> None:
        import os
        import tempfile
        from pathlib import Path
        from app.application.services.root_access import StaticBindings, accessible
        from app.domain.external.workspace_files import RootBinding
        from app.domain.models.identity import RootKind
        from app.domain.services.file_scope import FileScope
        from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
        if root is None:
            self._directory = tempfile.TemporaryDirectory(prefix="rayagent-loop-")
            root = self._directory.name
        self.root = Path(os.path.realpath(root))
        binding = RootBinding(root_id="r1", kind=RootKind.SESSION_WORKDIR, path=str(self.root))
        self.files = RecordingFiles(PosixWorkspaceFiles(StaticBindings([binding])))
        self.scope = FileScope(self.files, [accessible(binding)], working=accessible(binding))
        for name, content in (files or {}).items():
            self.put(name, content)

    def path(self, name: str) -> str:
        return str(self.root / name)

    def put(self, name: str, content) -> str:
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
        return str(target)

    def get(self, name: str) -> Optional[bytes]:
        target = self.root / name
        return target.read_bytes() if target.is_file() else None

    def text(self, name: str) -> Optional[str]:
        data = self.get(name)
        return data.decode("utf-8") if data is not None else None

    def exists(self, name: str) -> bool:
        return (self.root / name).exists()

    @property
    def calls(self) -> list:
        return self.files.calls


def make_loop(script: List[ScriptItem], *, session: Optional[Session] = None, deliver_file=None,
              max_iterations: int = 10, max_retries: int = 2, sandbox=None, files: Optional[FileFixture] = None,
              extra_tools: Sequence[BaseTool] = (), uow_factory=None, write_output=None,
              context_window: int = 32000, max_tokens: int = 4096,
              agent_config: Optional[Dict[str, Any]] = None,
              tool_policy: Optional[Dict[str, str]] = None, output_dir: Optional[str] = None) -> SimpleNamespace:
    """uow_factory 为空时使用内存仓库；传入真实数据库的 UoW 工厂时 store/events/runs 为空。

    write_output 为结果整形的落盘函数（为空时超长结果只截断）；agent_config 覆盖 AgentConfig 的其他字段；
    tool_policy 为工具策略规则表（为空时用默认策略）。
    """
    session = session if session is not None else Session(id="w1-loop")
    files = files if files is not None else FileFixture()
    llm = ScriptedLLM(script, context_window=context_window, max_tokens=max_tokens)
    recording = RecordingTool()
    uow_factory = uow_factory or make_uow_factory(session)
    loop = AgentLoop(
        uow_factory=uow_factory,
        llm=llm,
        agent_config=AgentConfig(max_iterations=max_iterations, max_retries=max_retries, **(agent_config or {})),
        session_id=session.id,
        tools=[FileTool(files.scope), MessageTool(), recording, *extra_tools],
        deliver_file=deliver_file,
        write_output=write_output,
        retry_interval=0,
        tool_policy=ToolPolicyConfig(rules=tool_policy) if tool_policy is not None else None,
        output_dir=output_dir,
    )
    store = getattr(uow_factory, "store", None)
    notifier = MemoryNotifier()
    return SimpleNamespace(loop=loop, llm=llm, session=session, sandbox=sandbox, files=files, recording=recording,
                           store=store, events=store.events if store else None,
                           runs=store.runs if store else None, inputs=store.inputs if store else None,
                           notifier=notifier, ledger=RunLedger(uow_factory, notifier))


def of_run(events: Sequence[BaseEvent], run_id: str) -> List[BaseEvent]:
    return [e for e in events if e.run_id == run_id]


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

def make_runner(h: SimpleNamespace, run: Optional[Run] = None,
                prior_status: Optional[SessionStatus] = None, approval=None) -> AgentTaskRunner:
    """用 make_loop 的结果组装运行器；附件放置与工具展示内容不属于这些实验。

    没有传入运行时直接在内存表里建一个 running 运行（相当于 chat 已受理），不写 run 事件。
    记忆与事件同事务保存，与生产运行器一致。
    """
    if run is None:
        run = Run(session_id=h.session.id)
        h.runs[run.id] = run.model_copy(deep=True)
        h.session.status = SessionStatus.RUNNING
    r = AgentTaskRunner.__new__(AgentTaskRunner)
    r._browser = None
    r._session_id, r._uow_factory, r._flow = h.session.id, h.loop._uow_factory, h.loop
    r._uow, r._sandbox, r._files = r._uow_factory(), h.sandbox, h.files.scope
    if r._sandbox is not None:
        r._sandbox.ensure_sandbox, r._sandbox.destroy = AsyncMock(), AsyncMock()
    r._mcp_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._a2a_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._ledger, r._run_id, r._prior_status = h.ledger, run.id, prior_status
    r._approval, r._workdir, r._claimed = approval, None, set()
    h.loop.run_id = run.id
    h.loop.persist_memory_with_events = True
    r._next_turn, r._failure_reason, r._shell_sessions = 1, None, []
    r._invoking, r._settled = False, asyncio.Event()
    r._place_attachments = AsyncMock()
    r._handle_tool_event = AsyncMock()
    r._flow._publish_delta = r._publish_delta
    return r


def input_task() -> SimpleNamespace:
    """进程内任务的替身；输入经持久输入记录传递，任务对象只承载身份。"""
    return SimpleNamespace(id="test-task", done=False, cancel=lambda: True)


def _add_input(session_id: str, message: MessageEvent):
    async def add(uow) -> None:
        await uow.run_input.add(RunInput(session_id=session_id, run_id=message.run_id, message_seq=message.seq))
    return add


async def start_run(h: SimpleNamespace, task, text: str) -> Run:
    """与 chat 新建运行一致：同一事务写 run(running)、用户消息与待消费输入。"""
    message = MessageEvent(role="user", message=text)
    return await h.ledger.start(h.session.id, events_after=[message], apply=_add_input(h.session.id, message))


async def resume_run(h: SimpleNamespace, run_id: str, text: str) -> Optional[Run]:
    """与 chat 续接等待中的运行一致：waiting → running、回复消息与待消费输入同事务提交。"""
    message = MessageEvent(role="user", message=text)
    return await h.ledger.transition(h.session.id, run_id, RunStatus.RUNNING, events_after=[message],
                                     apply=_add_input(h.session.id, message))


async def inject(h: SimpleNamespace, task, run_id: str, text: str) -> None:
    """与 chat 注入一致：消息与待消费输入同事务写入当前运行，循环在下一次模型请求前取走。"""
    message = MessageEvent(role="user", message=text)
    await h.ledger.append(h.session.id, [message], run_id=run_id, apply=_add_input(h.session.id, message))


def event_at(h: SimpleNamespace, seq: int) -> BaseEvent:
    return h.events[seq - 1]
