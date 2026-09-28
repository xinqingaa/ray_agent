#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/18 0:54
@Author  : thezehui@gmail.com
@File    : event.py
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import Literal, List, Union, Optional, Any, Dict, Annotated

from pydantic import BaseModel, Field, PrivateAttr

from .file import File
from .plan import Plan, Step
from .search import SearchResultItem
from .tool_result import ToolResult


class PlanEventStatus(str, Enum):
    """规划事件状态"""
    CREATED = "created"  # 已创建
    UPDATED = "updated"  # 已更新
    COMPLETED = "completed"  # 已完成


class StepEventStatus(str, Enum):
    """步骤事件状态"""
    STARTED = "started"  # 已开始
    COMPLETED = "completed"  # 已完成
    FAILED = "failed"  # 失败


class ToolEventStatus(str, Enum):
    """工具事件状态类型枚举"""
    CALLING = "calling"  # 调用中
    CALLED = "called"  # 调用完毕


class BaseEvent(BaseModel):
    """基础事件类型。seq 与 run_id 由事件仓库在写入时赋值，数据库是事实源。"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 事件id
    type: Literal[""] = ""  # 事件的类型
    created_at: datetime = Field(default_factory=datetime.now)  # 事件创建时间，毫秒精度落库
    seq: Optional[int] = None  # 会话内序号，从 1 递增
    run_id: Optional[str] = None  # 所属运行；用户消息属于它触发的运行


class PlanEvent(BaseEvent):
    """规划事件类型"""
    type: Literal["plan"] = "plan"
    plan: Plan  # 规划
    status: PlanEventStatus = PlanEventStatus.CREATED  # 规划事件状态


class TitleEvent(BaseEvent):
    """标题事件类型"""
    type: Literal["title"] = "title"
    title: str = ""  # 标题


class StepEvent(BaseEvent):
    """子任务/步骤事件"""
    type: Literal["step"] = "step"
    step: Step  # 步骤信息
    status: StepEventStatus = StepEventStatus.STARTED


class MessageEvent(BaseEvent):
    """消息事件，包含人类消息和AI消息"""
    type: Literal["message"] = "message"
    role: Literal["user", "assistant"] = "assistant"  # 消息角色
    message: str = ""  # 消息本身
    attachments: List[File] = Field(default_factory=list)  # 附件列表信息
    attempt: Optional[int] = None  # 助手正文对应的本轮模型请求序号；用户消息与交付通知为空


class BrowserToolContent(BaseModel):
    """浏览器工具扩展内容"""
    screenshot: str  # 浏览器快照截图


class SearchToolContent(BaseModel):
    """搜索工具内容"""
    results: List[SearchResultItem]  # 搜索结果列表


class ShellToolContent(BaseModel):
    """Shell工具内容"""
    console: Any  # 控制台内容


class FileToolContent(BaseModel):
    """文件工具内容"""
    content: str  # 文件内容


class ProtocolToolContent(BaseModel):
    """MCP/A2A 的唯一结果契约，实时流与持久化共用。"""
    outcome: ToolResult


ToolContent = Union[
    BrowserToolContent,
    SearchToolContent,
    ShellToolContent,
    FileToolContent,
    ProtocolToolContent,
]


class ToolResultShaping(BaseModel):
    """结果整形元数据：结果序列化后超过单条上限时，进入上下文的只是首尾预览。"""
    original_chars: int  # 完整内容（落盘文本，协议结果为适配层截断前的内容）的字符数
    preview_chars: int  # 进入上下文的预览序列化后的字符数
    truncated: bool = True
    full_output_path: Optional[str] = None  # 完整内容在沙箱中的路径；写入失败时为空，完整内容不可再读
    error: Optional[str] = None  # 写入失败的原因


class ToolEvent(BaseEvent):
    """工具事件"""
    type: Literal["tool"] = "tool"
    tool_call_id: str  # 工具调用id
    tool_name: str  # 工具箱/工具集的名字
    tool_content: Optional[ToolContent] = None  # 工具扩展内容
    function_name: str  # LLM调用函数/工具名字
    function_args: Dict[str, Any]  # LLM生成的工具调用参数
    function_result: Optional[ToolResult] = None  # 工具调用结果；called 事件上即进入上下文的内容（整形后为预览）
    status: ToolEventStatus = ToolEventStatus.CALLING  # 工具事件状态
    duration_ms: Optional[int] = None  # 工具管线从执行前到执行后的耗时，只在 called 事件上填写
    shaping: Optional[ToolResultShaping] = None  # 只在被整形的 called 事件上填写
    _raw_result: Optional[ToolResult] = PrivateAttr(default=None)  # 整形前的结果，只供运行器生成展示内容

    @property
    def raw_result(self) -> Optional[ToolResult]:
        return self._raw_result if self._raw_result is not None else self.function_result


class WaitEvent(BaseEvent):
    """等待事件，等待用户输入确认"""
    type: Literal["wait"] = "wait"


class ErrorEvent(BaseEvent):
    """错误事件"""
    type: Literal["error"] = "error"
    error: str = ""  # 错误信息


class DoneEvent(BaseEvent):
    """结束事件类型"""
    type: Literal["done"] = "done"


class TurnPhase(str, Enum):
    STARTED = "started"
    COMPLETED = "completed"


class TurnUsage(BaseModel):
    """一轮内返回了响应的各次尝试的用量合计；服务未返回的项为空。"""
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cached_tokens: Optional[int] = None
    reasoning_tokens: Optional[int] = None


class TurnEvent(BaseEvent):
    """轮次边界：一轮是一次模型请求（含传输重试）及其返回的工具批次。

    started 在请求发出前写入；completed 在批次全部有结果、提问中止批次、截断丢弃或请求失败后写入。
    进入终态时若最后一轮只有 started，账本在同一事务里补写 completed。
    """
    type: Literal["turn"] = "turn"
    phase: TurnPhase
    index: int  # 运行内从 1 递增
    # started
    context_estimate: Optional[Dict[str, Any]] = None  # 本轮请求的容量估算，字段见 ContextEstimate.as_dict()
    context_window: Optional[int] = None  # 本轮请求所用模型的上下文窗口
    # completed
    model_ms: Optional[int] = None  # 各次尝试的请求耗时合计，不含重试间隔
    attempts: Optional[int] = None  # 本轮发出的模型请求次数（含重试）
    ttft_ms: Optional[int] = None  # 产出本次响应的那次请求的首字延迟；非流式为空
    usage: Optional[TurnUsage] = None
    finish_reason: Optional[str] = None
    tool_call_ids: List[str] = Field(default_factory=list)  # 本轮经过工具管线、有 called 事件的调用
    tools_ms: Optional[int] = None  # 批次内工具耗时合计
    error: Optional[str] = None  # 请求失败时的原因代码


class AttemptReason(str, Enum):
    """失败的模型请求为什么没有进入历史。值稳定，界面文案由前端映射。"""
    TRANSPORT = "transport"  # 连接、超时、限流、5xx
    STREAM_INTERRUPTED = "stream_interrupted"  # 流在 finish_reason 前结束
    EMPTY = "empty"  # 既无文本也无工具调用
    MODEL_ERROR = "model_error"  # 不可重试的请求错误
    CANCELLED = "cancelled"  # 用户停止时这次请求还在进行


class AttemptEvent(BaseEvent):
    """一次失败、被重试或被停止取消的模型请求。不进入模型历史，请求重建忽略它。"""
    type: Literal["attempt"] = "attempt"
    turn: int  # 运行内轮次序号，与 turn.index 相同
    attempt: int  # 该轮内从 1 递增，含重试
    reason: AttemptReason
    chars: int = 0  # 这次尝试已经推送的文本字符数，不含推理内容
    retried: bool = False  # 这次失败之后还会再请求一次


class RunEvent(BaseEvent):
    """运行创建与每次状态变化；进入终态时附带汇总。"""
    type: Literal["run"] = "run"
    status: str  # RunStatus 取值
    reason: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None  # RunSummary 字段，终态才有


class ContextOp(str, Enum):
    APPEND = "append"  # 向模型历史追加消息（system 除外，system 在运行快照里）
    STRIP_REASONING = "strip_reasoning"  # 按 Memory.strip_reasoning 删除此前消息的推理字段
    REPLACE = "replace"  # 压缩：system 之后的全部消息替换为 messages（摘要、重新注入的用户原文、保留区）

    @classmethod
    def _missing_(cls, value: object) -> Optional["ContextOp"]:
        # W3 开发库里的旧值：当时的 compact 就是删除推理字段（外加已删除的浏览器结果替换）
        return cls.STRIP_REASONING if value == "compact" else None


class ContextEvent(BaseEvent):
    """模型可见即已记录：模型历史的每次变化都先成为事件，请求重建按序回放这些事件。"""
    type: Literal["context"] = "context"
    op: ContextOp = ContextOp.APPEND
    messages: List[Dict[str, Any]] = Field(default_factory=list)


class CompactUsage(BaseModel):
    """摘要请求各次尝试的用量合计；计入运行的模型请求数与 tokens，不算一轮。"""
    attempts: int = 0
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cached_tokens: Optional[int] = None


class CompactEvent(BaseEvent):
    """自动压缩：较早的轮次替换为摘要，用户消息原文重新注入。随后的 context(replace) 事件携带替换后的消息全文。"""
    type: Literal["compact"] = "compact"
    trigger: Literal["watermark", "overflow"] = "watermark"  # 估算超过水位 / 服务端以上下文超长拒绝
    before_estimate: Dict[str, Any] = Field(default_factory=dict)  # 压缩前的容量估算
    after_estimate: Dict[str, Any] = Field(default_factory=dict)  # 替换后的容量估算
    summarized_turns: int = 0  # 进入摘要的轮数（助手消息及其工具结果）
    kept_turns: int = 0  # 原样保留的最近轮数
    summary: str = ""  # 摘要全文
    reinjected_event_seqs: List[int] = Field(default_factory=list)  # 重新注入的用户消息对应的 message 事件
    omitted_user_messages: int = 0  # 因总量上限未重新注入、只由摘要覆盖的用户消息条数
    usage: CompactUsage = Field(default_factory=CompactUsage)


class CleanupTarget(BaseModel):
    kind: Literal["shell", "a2a"] = "shell"
    id: str
    success: bool
    message: str = ""


class CleanupEvent(BaseEvent):
    """停止后的收尾结果：逐个终止本次运行登记的 Shell 会话。失败不改变运行终态。"""
    type: Literal["cleanup"] = "cleanup"
    targets: List[CleanupTarget] = Field(default_factory=list)


# 定义应用事件类型声明
Event = Annotated[
    Union[
        PlanEvent,
        TitleEvent,
        StepEvent,
        MessageEvent,
        ToolEvent,
        WaitEvent,
        ErrorEvent,
        DoneEvent,
        TurnEvent,
        AttemptEvent,
        RunEvent,
        ContextEvent,
        CompactEvent,
        CleanupEvent,
    ],
    Field(discriminator="type"),
]


def latest_plan(events: List["BaseEvent"]) -> Optional[Plan]:
    """事件列表中最新的计划。"""
    for event in reversed(events):
        if isinstance(event, PlanEvent):
            return event.plan
    return None
