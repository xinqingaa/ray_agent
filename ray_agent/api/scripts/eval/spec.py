"""评测任务的声明式定义与注册表。

新任务在 ``tasks.py``（或另一个被导入的模块）中用 ``@register`` 注册一个返回 ``TaskSpec`` 的函数，
ID 决定默认运行顺序。运行器只依赖本模块的结构，不关心具体任务。
"""
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Union

from .client import RayAgentClient


class SkipTask(Exception):
    """运行环境不满足任务前提；报告记为“跳过：原因”，不算通过。"""


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""
    required: bool = True  # False 表示只记录观察，不影响任务结论


@dataclass
class ReplyOnWait:
    """出现提问（wait 事件）时按顺序回复；超过次数后不再回复，任务停在等待。"""
    replies: List[str]


@dataclass
class StopAfter:
    """在触发点之后 ``seconds`` 秒请求停止。

    ``trigger`` 接收每条 SSE 事件 (event, data)，首次返回 True 时开始计时；为空时从首条消息发出开始计时。
    所有轮次结束时仍未到停止时刻，则取消停止，避免改写已结束会话的状态。
    """
    seconds: float
    trigger: Optional[Callable[[str, Dict[str, Any]], bool]] = None
    observe: Optional[Callable[["RunContext"], Awaitable[None]]] = None  # 停止请求返回后立即执行


Message = Union[str, Callable[["RunContext"], str]]
Environment = Callable[["RunContext"], "AsyncIterator[None]"]
Check = Callable[["RunContext"], Awaitable[List[CheckResult]]]


@asynccontextmanager
async def no_environment(ctx: "RunContext") -> AsyncIterator[None]:
    yield


@dataclass
class TaskSpec:
    id: str
    title: str
    turns: List[Message]  # 每一轮在上一轮结束（done/error/未回复的 wait）后发送
    check: Check
    materials: Dict[str, bytes] = field(default_factory=dict)  # 上传并随第一轮发送的附件
    on_wait: Optional[ReplyOnWait] = None
    stop: Optional[StopAfter] = None
    environment: Callable[["RunContext"], Any] = no_environment  # asynccontextmanager，可抛 SkipTask
    timeout: float = 600.0  # 整个任务的墙钟上限（秒），超时会请求停止


@dataclass
class RunContext:
    """单次运行的共享状态，环境、交互钩子与检查函数都通过它读写。"""
    client: RayAgentClient
    spec: TaskSpec
    run_index: int
    session_id: str = ""
    uploads: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # 文件名 -> 上传返回的文件信息
    env: Dict[str, Any] = field(default_factory=dict)  # 环境准备写入的地址、端口等
    observations: Dict[str, Any] = field(default_factory=dict)  # 交互钩子与检查写入的观察
    sse_log: List[Dict[str, Any]] = field(default_factory=list)
    interactions: List[Dict[str, Any]] = field(default_factory=list)
    session: Dict[str, Any] = field(default_factory=dict)  # 结束后 GET /sessions/{id} 的结果
    started_at: float = 0.0
    stop_requested_at: Optional[float] = None

    def elapsed(self) -> float:
        return round(time.monotonic() - self.started_at, 3) if self.started_at else 0.0

    def log(self, kind: str, **fields: Any) -> None:
        self.interactions.append({"t": self.elapsed(), "kind": kind, **fields})

    # ---- 会话事件读取（基于 GET /sessions/{id} 的持久化事件） ----

    @property
    def events(self) -> List[Dict[str, Any]]:
        return self.session.get("events", []) if self.session else []

    def turns(self) -> List[List[Dict[str, Any]]]:
        """按用户消息切分事件；第 i 个元素是第 i 条用户消息（含回复提问）及其后的事件。"""
        groups: List[List[Dict[str, Any]]] = []
        for event in self.events:
            if event["event"] == "message" and event["data"].get("role") == "user":
                groups.append([])
            if groups:
                groups[-1].append(event)
        return groups

    @staticmethod
    def assistant_messages(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [e["data"] for e in events if e["event"] == "message" and e["data"].get("role") == "assistant"]

    def assistant_text(self, events: Optional[List[Dict[str, Any]]] = None) -> str:
        return "\n".join(m.get("message", "") for m in self.assistant_messages(self.events if events is None else events))

    def final_reply(self, events: Optional[List[Dict[str, Any]]] = None) -> str:
        """最后一条助手消息；默认取最后一轮。规划说明等中间消息可能复述问题，不作为答复依据。"""
        if events is None:
            turns = self.turns()
            events = turns[-1] if turns else []
        messages = self.assistant_messages(events)
        return messages[-1].get("message", "") if messages else ""

    def delivered_files(self) -> List[Dict[str, Any]]:
        files: List[Dict[str, Any]] = []
        for message in self.assistant_messages(self.events):
            files.extend(message.get("attachments") or [])
        return files

    def tool_events(self, status: str = "called") -> List[Dict[str, Any]]:
        return [e["data"] for e in self.events if e["event"] == "tool" and e["data"].get("status") == status]


_REGISTRY: Dict[str, Callable[[], TaskSpec]] = {}


def register(task_id: str) -> Callable[[Callable[[], TaskSpec]], Callable[[], TaskSpec]]:
    def decorator(factory: Callable[[], TaskSpec]) -> Callable[[], TaskSpec]:
        if task_id in _REGISTRY:
            raise ValueError(f"评测任务 {task_id} 重复注册")
        _REGISTRY[task_id] = factory
        return factory
    return decorator


def _order(task_id: str) -> tuple:
    prefix = task_id.rstrip("0123456789")
    number = task_id[len(prefix):]
    return prefix, int(number) if number else 0


def registered_ids() -> List[str]:
    return sorted(_REGISTRY, key=_order)


def build(task_id: str) -> TaskSpec:
    spec = _REGISTRY[task_id]()
    if spec.id != task_id:
        raise ValueError(f"注册 ID {task_id} 与 TaskSpec.id {spec.id} 不一致")
    return spec
