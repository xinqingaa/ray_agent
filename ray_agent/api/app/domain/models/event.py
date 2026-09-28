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

from pydantic import BaseModel, Field

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


class ToolEvent(BaseEvent):
    """工具事件"""
    type: Literal["tool"] = "tool"
    tool_call_id: str  # 工具调用id
    tool_name: str  # 工具箱/工具集的名字
    tool_content: Optional[ToolContent] = None  # 工具扩展内容
    function_name: str  # LLM调用函数/工具名字
    function_args: Dict[str, Any]  # LLM生成的工具调用参数
    function_result: Optional[ToolResult] = None  # 工具调用结果
    status: ToolEventStatus = ToolEventStatus.CALLING  # 工具事件状态
    duration_ms: Optional[int] = None  # 工具管线从执行前到执行后的耗时，只在 called 事件上填写


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
    context_estimate: Optional[Dict[str, Any]] = None  # W2 的四部分估算；W2 合入前为空
    context_window: Optional[int] = None  # 本轮请求所用模型的上下文窗口
    # completed
    model_ms: Optional[int] = None  # 各次尝试的请求耗时合计，不含重试间隔
    attempts: Optional[int] = None  # 本轮发出的模型请求次数（含重试）
    usage: Optional[TurnUsage] = None
    finish_reason: Optional[str] = None
    tool_call_ids: List[str] = Field(default_factory=list)  # 本轮经过工具管线、有 called 事件的调用
    tools_ms: Optional[int] = None  # 批次内工具耗时合计
    error: Optional[str] = None  # 请求失败时的原因代码


class RunEvent(BaseEvent):
    """运行创建与每次状态变化；进入终态时附带汇总。"""
    type: Literal["run"] = "run"
    status: str  # RunStatus 取值
    reason: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None  # RunSummary 字段，终态才有


class ContextOp(str, Enum):
    APPEND = "append"  # 向模型历史追加消息（system 除外，system 在运行快照里）
    COMPACT = "compact"  # 按 Memory.compact 规则裁剪此前的消息


class ContextEvent(BaseEvent):
    """模型可见即已记录：模型历史的每次变化都先成为事件，请求重建按序回放这些事件。"""
    type: Literal["context"] = "context"
    op: ContextOp = ContextOp.APPEND
    messages: List[Dict[str, Any]] = Field(default_factory=list)


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
        RunEvent,
        ContextEvent,
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
