#!/usr/bin/env python
# -*- coding: utf-8 -*-
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, Self, Type, Literal, List, Union, get_args

from pydantic import BaseModel, Field, ConfigDict

from app.domain.models.event import Event, PlanEvent, ToolEventStatus, ToolEvent, StepEvent, ContextEvent, \
    TurnUsage, ToolResultShaping, CompactUsage, ApprovalEvent
from app.domain.models.file import File
from app.domain.models.plan import ExecutionStatus

_BASE_FIELDS = {"id", "type", "created_at", "seq", "run_id"}


def to_epoch_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


class BaseEventData(BaseModel):
    """基础事件数据。seq 是会话内序号（SSE 的 id），created_at 是毫秒时间戳。"""
    event_id: Optional[str] = None  # 事件id
    seq: Optional[int] = None
    run_id: Optional[str] = None
    created_at: int = 0  # 事件时间，毫秒时间戳

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
    """基础流式事件数据类型"""
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


class CommonEventData(BaseEventData):
    """通用事件数据，让结构允许填充额外的数据"""
    model_config = ConfigDict(extra="allow")


class CommonSSEEvent(BaseSSEEvent):
    """通用事件"""
    event: str
    data: CommonEventData


class MessageEventData(BaseEventData):
    """消息事件数据"""
    role: Literal["user", "assistant"] = "assistant"
    message: str = ""
    attachments: List[File] = Field(default_factory=list)
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
                description=event.step.description
            )
        )


class PlanEventData(BaseEventData):
    plan_id: str
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
                plan_id=event.plan.id,
                steps=[
                    StepEventData(
                        **BaseEventData.base_event_data(event),
                        id=step.id,
                        status=step.status,
                        description=step.description,
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
    shaping: Optional[ToolResultShaping] = None  # 结果被整形时：原始字符数、是否截断、完整内容路径
    # 未执行：被工具策略禁止 / 被用户拒绝 / 计划模式不允许，只在 called 上
    denied_by: Optional[Literal["policy", "user", "plan_mode"]] = None


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


class DoneSSEEvent(BaseSSEEvent):
    """停止流式事件"""
    event: Literal["done"] = "done"


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
    project_file_protection: Optional[Dict[str, Any]] = None


class EnvironmentSSEEvent(BaseSSEEvent):
    event: Literal["environment"] = "environment"
    data: EnvironmentEventData


class RunEventData(BaseEventData):
    """运行状态变化事件数据；终态时 summary 为运行汇总，mode 为运行模式（normal / plan）。"""
    status: str
    reason: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None


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


# 定义Agent流式事件类型集合
AgentSSEEvent = Union[
    CommonSSEEvent,
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
    ApprovalSSEEvent,
]


@dataclass
class EventMapping:
    """事件映射数据类，用于存储事件映射信息，涵盖流式事件类型、数据类、事件类型字符串"""
    sse_event_class: Type[BaseSSEEvent]
    data_class: Type[BaseEventData]
    event_type: str


class EventMapper:
    """事件映射类，利用Python自身提供的自省机制，将业务逻辑中的Event转换成适合流式传输的AgentSSEEvent"""
    # 缓存映射(type: EventMapping)
    _cache_mapping: Optional[Dict[str, EventMapping]] = None

    @staticmethod
    def _get_event_type_mapping() -> Dict[str, EventMapping]:
        """通过反射动态构建从事件类型字符串到AgentSSEEvent的映射"""
        # 1.判断缓存映射是否存在，如果存在则直接返回
        if EventMapper._cache_mapping is not None:
            return EventMapper._cache_mapping

        # 2.获取AgentSSEEvent的所有可能存在类
        sse_event_classes = get_args(AgentSSEEvent)
        mapping = {}

        # 3.循环遍历AgentSSEEvent可能的所有类逐个处理
        for sse_event_class in sse_event_classes:
            # 4.跳过基类
            if sse_event_class == BaseSSEEvent:
                continue

            # 5.检查类是否包含event属性
            if hasattr(sse_event_class, "__annotations__") and "event" in sse_event_class.__annotations__:
                # 6.提取事件字段
                event_field = sse_event_class.__annotations__["event"]

                # 7.提取事件的具体值(Literal的值)
                if hasattr(event_field, "__args__") and len(event_field.__args__) > 0:
                    event_type = event_field.__args__[0]

                    # 8.提取sse的载荷数据
                    data_class = None
                    if hasattr(sse_event_class, "__annotations__") and "data" in sse_event_class.__annotations__:
                        data_class = sse_event_class.__annotations__["data"]

                    # 9.构建并注册映射关系
                    mapping[event_type] = EventMapping(
                        sse_event_class=sse_event_class,
                        data_class=data_class,
                        event_type=event_type
                    )

        # 10.更新类级缓存
        EventMapper._cache_mapping = mapping
        return mapping

    @staticmethod
    def event_to_sse_event(event: Event) -> AgentSSEEvent:
        """将领域事件转换为Agent流式事件模型"""
        # 1.获取事件映射表
        event_type_mapping = EventMapper._get_event_type_mapping()

        # 2.根据传递进来的事件获取映射类
        event_mapping = event_type_mapping.get(event.type)

        # 3.如果找到了类型映射则进行转换
        if event_mapping:
            sse_event = event_mapping.sse_event_class.from_event(event)
            return sse_event

        # 4.如果没找到类型则使用通用类型
        return CommonSSEEvent.from_event(event)

    @staticmethod
    def events_to_sse_events(events: List[Event]) -> List[AgentSSEEvent]:
        """将领域事件模型列表转换为SSE流式事件列表"""
        return list(filter(lambda x: x is not None, [
            EventMapper.event_to_sse_event(event) for event in events
        ]))
