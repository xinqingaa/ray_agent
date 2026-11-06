#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话事件信封与联合类型。

信封是 `{event, data}`：event 为事件类型，data 先带公共元数据（event_id、会话内序号 seq、run_id、
毫秒时间 created_at、事件版本 event_version），再带各类型字段。SSE 帧的 event 行就是信封的 event，
data 行是信封的 data，id 行是 seq；会话详情的 events 列表直接返回信封。文本增量只走 SSE，没有 seq。
"""
from app.domain.models.message import SkillSelection
from datetime import datetime
from typing import Annotated, Optional, Dict, Any, Self, Type, Literal, List, Union

from pydantic import BaseModel, Field, ConfigDict

from app.domain.external.event_notifier import OutputDelta
from app.domain.models.event import Event, PlanEvent, ToolEventStatus, ToolEvent, StepEvent, ContextEvent, \
    TurnUsage, ToolResultShaping, CompactUsage, ApprovalEvent, CleanupTarget
from app.domain.models.file import File
from app.domain.models.identity import RunId, SessionId
from app.domain.models.plan import ExecutionStatus
from app.domain.models.plan_acceptance import PlanAcceptance
from app.domain.models.run import RunMode, RunStatus

# 事件结构不兼容地变化（删除或改义字段、改变类型）时递增；只新增字段或新增事件类型不递增。
EVENT_VERSION = 1

type EventVersion = Annotated[int, Field(ge=1, description="事件结构版本")]

_BASE_FIELDS = {"id", "type", "created_at", "seq", "run_id"}
_RESPONSE_SCHEMA = ConfigDict(json_schema_serialization_defaults_required=True)


def to_epoch_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


class BaseEventData(BaseModel):
    """信封的公共元数据。seq 是会话内序号（SSE 的 id），created_at 是毫秒时间戳。"""
    model_config = _RESPONSE_SCHEMA

    event_id: Optional[str] = None  # 事件id
    seq: Optional[int] = None
    run_id: Optional[RunId] = None
    created_at: int = 0  # 事件时间，毫秒时间戳
    event_version: EventVersion = EVENT_VERSION

    @classmethod
    def base_event_data(cls, event: Event) -> Dict[str, Any]:
        """类方法，用于将事件Domain模型转换成基础事件数据字典"""
        return {
            "event_id": event.id,
            "seq": event.seq,
            "run_id": event.run_id,
            "created_at": to_epoch_ms(event.created_at),
        }

    @classmethod
    def from_event(cls, event: Event) -> Self:
        """从事件Domain模型中构建基础事件数据"""
        return cls(
            **cls.base_event_data(event),
            **event.model_dump(mode="json", exclude=_BASE_FIELDS),
        )


class BaseSSEEvent(BaseModel):
    """事件信封：event 为事件类型，data 为元数据与该类型的字段"""
    model_config = _RESPONSE_SCHEMA

    event: str  # 事件类型
    data: BaseEventData  # 数据

    @classmethod
    def from_event(cls, event: Event) -> Self:
        """将事件Domain模型转换成基础流式事件"""
        # 1.获取事件数据的类型，如果没有则使用基础事件数据BaseEventData
        data_class: Type[BaseEventData] = cls.__annotations__.get("data", BaseEventData)

        # 2.调用构造函数完成初始化
        return cls(
            event=event.type,
            data=data_class.from_event(event),
        )


class MessageEventData(BaseEventData):
    """消息事件数据"""
    role: Literal["user", "assistant"] = "assistant"
    message: str = ""
    attachments: List[File] = Field(default_factory=list)
    skill: SkillSelection | None = None
    image_mode: Literal['auto', 'files'] = 'auto'
    attempt: Optional[int] = None  # 助手正文对应的本轮模型请求序号


class MessageSSEEvent(BaseSSEEvent):
    """流式消息事件数据响应结构"""
    event: Literal["message"] = "message"
    data: MessageEventData

    @classmethod
    def from_event(cls, event: Event) -> Self:
        return cls(
            data=MessageEventData(
                **BaseEventData.base_event_data(event),
                role=event.role,
                message=event.message,
                attachments=event.attachments,
                image_mode=event.image_mode,
                skill=event.skill,
                attempt=event.attempt,
            )
        )


class TitleEventData(BaseEventData):
    """标题事件数据"""
    title: str


class TitleSSEEvent(BaseSSEEvent):
    """标题流式事件"""
    event: Literal["title"] = "title"
    data: TitleEventData


class StepEventData(BaseEventData):
    """步骤事件数据"""
    id: str  # 步骤id
    status: ExecutionStatus  # 步骤执行状态
    description: str  # 步骤描述
    kind: str = "stage"
    parent_id: Optional[str] = None
    schedule: str = "current"
    reason: str = ""


class StepSSEEvent(BaseSSEEvent):
    """步骤流式事件"""
    event: Literal["step"] = "step"
    data: StepEventData

    @classmethod
    def from_event(cls, event: StepEvent) -> Self:
        return cls(
            data=StepEventData(
                **BaseEventData.base_event_data(event),
                status=event.step.status,
                id=event.step.id,
                description=event.step.description,
                kind=event.step.kind,
                parent_id=event.step.parent_id,
                schedule=event.step.schedule,
                reason=event.step.reason,
            )
        )


class PlanEventData(BaseEventData):
    plan_id: str
    title: str = ""
    description: str = ""
    goal: str = ""
    scope: str = ""
    artifacts: List[dict] = Field(default_factory=list)
    progress_state: str = "confirmed"
    review_only: bool = False
    accepted_from: Optional[PlanAcceptance] = None
    explanation: str = ""
    """计划事件数据"""
    steps: List[StepEventData]


class PlanSSEEvent(BaseSSEEvent):
    """计划流式事件"""
    event: Literal["plan"] = "plan"
    data: PlanEventData

    @classmethod
    def from_event(cls, event: PlanEvent) -> Self:
        return cls(
            data=PlanEventData(
                **BaseEventData.base_event_data(event),
                plan_id=event.plan.id, title=event.plan.title, description=event.plan.description,
                goal=event.plan.goal, scope=event.plan.scope,
                artifacts=[a.model_dump() for a in event.plan.artifacts],
                progress_state=event.progress_state,
                review_only=event.review_only,
                accepted_from=event.accepted_from,
                explanation=event.plan.message,
                steps=[
                    StepEventData(
                        **BaseEventData.base_event_data(event),
                        id=step.id,
                        status=step.status,
                        description=step.description, kind=step.kind, parent_id=step.parent_id,
                        schedule=step.schedule, reason=step.reason,
                    )
                    for step in event.plan.steps
                ]
            )
        )


class ToolEventData(BaseEventData):
    """工具事件数据"""
    tool_call_id: str  # 工具调用id
    name: str  # 工具箱名字
    status: ToolEventStatus  # 工具状态
    function: str  # 工具名字
    args: Dict[str, Any]  # 工具参数
    content: Optional[Any] = None  # 工具调用结果
    duration_ms: Optional[int] = None  # 工具耗时，只在 called 事件上有值
    stages_ms: Dict[str, int] = Field(default_factory=dict)
    shaping: Optional[ToolResultShaping] = None  # 结果被整形时：原始字符数、是否截断、完整内容路径
    # 未执行：被工具策略禁止 / 被用户拒绝 / 计划模式不允许 / 预算收尾阶段不允许，只在 called 上
    denied_by: Optional[Literal["policy", "user", "plan_mode", "budget", "batch", "verification_cache", "verification_limit"]] = None


class ToolSSEEvent(BaseSSEEvent):
    """工具流式事件"""
    event: Literal["tool"] = "tool"
    data: ToolEventData

    @classmethod
    def from_event(cls, event: ToolEvent) -> Self:
        return cls(
            data=ToolEventData(
                **BaseEventData.base_event_data(event),
                tool_call_id=event.tool_call_id,
                name=event.tool_name,
                status=event.status,
                function=event.function_name,
                args=event.function_args,
                content=event.tool_content,
                duration_ms=event.duration_ms,
                stages_ms=event.stages_ms,
                shaping=event.shaping,
                denied_by=event.denied_by,
            )
        )


class ApprovalEventData(BaseEventData):
    """工具级审批。字段名与工具事件一致（name 为工具集、function 为函数名、args 为参数）；decided_at 为毫秒时间戳。"""
    tool_call_id: str
    name: str
    function: str
    args: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["pending", "approved", "rejected", "expired"]
    rule: Optional[str] = None  # 命中的策略规则键
    service: Optional[str] = None  # MCP 服务名或 A2A 远程 Agent id
    service_tool: Optional[str] = None  # MCP 服务端原始工具名；A2A 为 call_remote_agent
    decided_at: Optional[int] = None


class ApprovalSSEEvent(BaseSSEEvent):
    """工具级审批流式事件"""
    event: Literal["approval"] = "approval"
    data: ApprovalEventData

    @classmethod
    def from_event(cls, event: ApprovalEvent) -> Self:
        return cls(
            data=ApprovalEventData(
                **BaseEventData.base_event_data(event),
                tool_call_id=event.tool_call_id,
                name=event.tool_name,
                function=event.function_name,
                args=event.function_args,
                status=event.status.value,
                rule=event.rule,
                service=event.service,
                service_tool=event.service_tool,
                decided_at=to_epoch_ms(event.decided_at) if event.decided_at else None,
            )
        )


class DoneEventData(BaseEventData):
    outcome: str = "complete"
    missing: List[str] = Field(default_factory=list)


class DoneSSEEvent(BaseSSEEvent):
    """停止流式事件"""
    event: Literal["done"] = "done"
    data: DoneEventData

    @classmethod
    def from_event(cls, event):
        return cls(data=DoneEventData(**BaseEventData.base_event_data(event), outcome=event.outcome, missing=event.missing))


class WaitSSEEvent(BaseSSEEvent):
    """等待人类输入流式事件"""
    event: Literal["wait"] = "wait"


class ErrorEventData(BaseEventData):
    """错误事件数据"""
    error: str
    context_estimate: Optional[Dict[str, Any]] = None
    fixed_input_exceeded: bool = False


class ErrorSSEEvent(BaseSSEEvent):
    """错误流式事件"""
    event: Literal["error"] = "error"
    data: ErrorEventData


class TurnEventData(BaseEventData):
    """轮次边界事件数据，字段含义见领域模型 TurnEvent。"""
    phase: Literal["started", "completed"]
    index: int
    context_estimate: Optional[Dict[str, Any]] = None
    context_window: Optional[int] = None
    model_ms: Optional[int] = None
    attempts: Optional[int] = None
    ttft_ms: Optional[int] = None
    usage: Optional[TurnUsage] = None
    finish_reason: Optional[str] = None
    tool_call_ids: List[str] = Field(default_factory=list)
    tools_ms: Optional[int] = None
    error: Optional[str] = None


class TurnSSEEvent(BaseSSEEvent):
    """轮次边界流式事件"""
    event: Literal["turn"] = "turn"
    data: TurnEventData


class AttemptEventData(BaseEventData):
    """失败的模型请求。reason 是稳定代码，chars 是已推送的文本字符数。"""
    turn: int
    attempt: int
    reason: str
    chars: int = 0
    retried: bool = False


class AttemptSSEEvent(BaseSSEEvent):
    """失败尝试流式事件"""
    event: Literal["attempt"] = "attempt"
    data: AttemptEventData


class EnvironmentEventData(BaseEventData):
    status: Literal["preparing", "ready"]
    message: Optional[str] = None


class EnvironmentSSEEvent(BaseSSEEvent):
    event: Literal["environment"] = "environment"
    data: EnvironmentEventData


class RunEventData(BaseEventData):
    """运行状态变化事件数据；终态时 summary 为运行汇总，mode 为运行模式（normal / plan）。"""
    status: RunStatus
    reason: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None
    mode: Optional[RunMode] = None


class RunSSEEvent(BaseSSEEvent):
    """运行状态流式事件"""
    event: Literal["run"] = "run"
    data: RunEventData


class ContextEventData(BaseEventData):
    """模型历史变化的轻量投影：消息全文只在数据库与请求重建接口里，推送时只给条数与角色。"""
    op: Literal["append", "strip_reasoning", "replace"]
    message_count: int = 0
    roles: List[str] = Field(default_factory=list)


class CompactEventData(BaseEventData):
    """压缩事件数据，字段含义见领域模型 CompactEvent；摘要全文随事件推送，供开发者视图显示。manual 时 run_id 为空。"""
    trigger: Literal["watermark", "overflow", "manual"]
    before_estimate: Dict[str, Any] = Field(default_factory=dict)
    after_estimate: Dict[str, Any] = Field(default_factory=dict)
    summarized_turns: int = 0
    kept_turns: int = 0
    summary: str = ""
    reinjected_event_seqs: List[int] = Field(default_factory=list)
    omitted_user_messages: int = 0
    usage: CompactUsage = Field(default_factory=CompactUsage)


class CompactSSEEvent(BaseSSEEvent):
    """压缩流式事件"""
    event: Literal["compact"] = "compact"
    data: CompactEventData


class ContextSSEEvent(BaseSSEEvent):
    """模型历史变化流式事件"""
    event: Literal["context"] = "context"
    data: ContextEventData

    @classmethod
    def from_event(cls, event: ContextEvent) -> Self:
        return cls(
            data=ContextEventData(
                **BaseEventData.base_event_data(event),
                op=event.op.value,
                message_count=len(event.messages),
                roles=[str(message.get("role", "")) for message in event.messages],
            )
        )


class CleanupEventData(BaseEventData):
    """停止后的收尾结果，失败不改变运行终态。"""
    targets: List[CleanupTarget] = Field(default_factory=list)


class CleanupSSEEvent(BaseSSEEvent):
    event: Literal["cleanup"] = "cleanup"
    data: CleanupEventData


class DeltaEventData(BaseModel):
    """文本增量：不落库，没有 seq，重连不补发；按 (run_id, turn, attempt) 拼接。"""
    model_config = _RESPONSE_SCHEMA

    session_id: SessionId
    run_id: RunId
    turn: int
    attempt: int
    delta: str
    event_version: EventVersion = EVENT_VERSION


class DeltaSSEEvent(BaseModel):
    model_config = _RESPONSE_SCHEMA

    event: Literal["delta"] = "delta"
    data: DeltaEventData

    @classmethod
    def from_delta(cls, item: OutputDelta) -> Self:
        return cls(data=DeltaEventData(session_id=item.session_id, run_id=item.run_id, turn=item.turn,
                                       attempt=item.attempt, delta=item.delta))


SESSION_EVENT_CLASSES: tuple[Type[BaseSSEEvent], ...] = (
    MessageSSEEvent,
    TitleSSEEvent,
    StepSSEEvent,
    PlanSSEEvent,
    ToolSSEEvent,
    DoneSSEEvent,
    ErrorSSEEvent,
    WaitSSEEvent,
    TurnSSEEvent,
    AttemptSSEEvent,
    RunSSEEvent,
    EnvironmentSSEEvent,
    ContextSSEEvent,
    CompactSSEEvent,
    CleanupSSEEvent,
    ApprovalSSEEvent,
)

# 落库事件的联合类型：会话详情的 events 与 SSE 中带 id 的帧
type SessionEvent = Annotated[Union[*SESSION_EVENT_CLASSES], Field(discriminator="event")]
# SSE 可能出现的全部帧
type StreamEvent = Annotated[Union[*SESSION_EVENT_CLASSES, DeltaSSEEvent], Field(discriminator="event")]


class EventMapper:
    """把领域事件映射为信封；每种领域事件都必须有对应的信封类型。"""
    _mapping: Dict[str, Type[BaseSSEEvent]] = {
        cls.model_fields["event"].default: cls for cls in SESSION_EVENT_CLASSES
    }

    @staticmethod
    def event_to_sse_event(event: Event) -> BaseSSEEvent:
        sse_event_class = EventMapper._mapping.get(event.type)
        if sse_event_class is None:
            raise ValueError(f"事件类型 {event.type} 没有对应的信封")
        return sse_event_class.from_event(event)

    @staticmethod
    def events_to_sse_events(events: List[Event]) -> List[BaseSSEEvent]:
        return [EventMapper.event_to_sse_event(event) for event in events]
