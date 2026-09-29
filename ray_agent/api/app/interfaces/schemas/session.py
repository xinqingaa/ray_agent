#!/usr/bin/env python
# -*- coding: utf-8 -*-
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.domain.models.file import File
from app.domain.models.run import Run
from app.domain.models.session import SessionStatus
from app.interfaces.schemas.event import AgentSSEEvent, to_epoch_ms


class CreateSessionResponse(BaseModel):
    """创建会话响应结构"""
    session_id: str  # 会话id


class ListSessionItem(BaseModel):
    """会话列表条目基础信息"""
    session_id: str = ""
    title: str = ""
    latest_message: str = ""
    latest_message_at: Optional[datetime] = Field(default_factory=datetime.now)
    status: SessionStatus = SessionStatus.PENDING
    unread_message_count: int = 0


class ListSessionResponse(BaseModel):
    """获取会话列表基础信息响应结构"""
    sessions: List[ListSessionItem]


class ChatRequest(BaseModel):
    """聊天请求结构"""
    message: Optional[str] = None  # 人类消息，不能为空
    attachments: Optional[List[str]] = Field(default_factory=list)  # 附件列表(传递的是文件id列表)
    timestamp: Optional[int] = None  # 当前时间戳（秒）
    # 只在新建运行时生效；会话有活动运行（注入或续接）时带 plan 返回 409
    mode: Literal["normal", "plan"] = "normal"


class ChatResponse(BaseModel):
    """chat 受理结果：消息事件的 seq 与处理它的运行；执行过程通过 GET /sessions/{id}/events 观察。"""
    run_id: str
    seq: int
    route: str  # started / resumed / injected


class RenameTitleRequest(BaseModel):
    title: str


class TitleResponse(BaseModel):
    title: str


class ApprovalRequest(BaseModel):
    """审批回复：approve 执行该调用一次，deny 回填“用户拒绝执行”。"""
    decision: Literal["approve", "deny"]


class ApprovalResponse(BaseModel):
    """审批受理结果：approval 事件的 seq 与续接的运行；执行过程通过事件流观察。"""
    run_id: str
    seq: int
    status: Literal["approved", "rejected"]


class CompactResponse(BaseModel):
    """手动压缩结果。compacted：两条事件的 seq、前后估算总量（按字符估算的 tokens）与轮数；
    skipped：reason 为 no_rounds，没有写事件，其余字段为空。"""
    status: Literal["compacted", "skipped"]
    reason: Optional[Literal["no_rounds"]] = None
    message: str
    compact_seq: Optional[int] = None
    context_seq: Optional[int] = None
    before_total: Optional[int] = None
    after_total: Optional[int] = None
    summarized_turns: Optional[int] = None
    kept_turns: Optional[int] = None


class RunItem(BaseModel):
    """运行摘要；时间为毫秒时间戳。"""
    run_id: str
    status: str
    reason: Optional[str] = None
    mode: Literal["normal", "plan"] = "normal"
    started_at: int
    ended_at: Optional[int] = None
    turns: int = 0
    model_requests: int = 0
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: Optional[int] = None

    @classmethod
    def from_run(cls, run: Run) -> "RunItem":
        return cls(
            run_id=run.id,
            status=run.status.value,
            reason=run.reason,
            mode=run.mode.value,
            started_at=to_epoch_ms(run.started_at),
            ended_at=to_epoch_ms(run.ended_at) if run.ended_at else None,
            turns=run.turns,
            model_requests=run.model_requests,
            tool_calls=run.tool_calls,
            prompt_tokens=run.prompt_tokens,
            completion_tokens=run.completion_tokens,
            cached_tokens=run.cached_tokens,
        )


class GetSessionResponse(BaseModel):
    """获取会话详情响应结构。events 为 after_seq 之后按 seq 升序的事件；last_seq 是会话当前最大 seq。"""
    session_id: str
    title: Optional[str] = None
    status: SessionStatus
    runs: List[RunItem] = Field(default_factory=list)
    events: List[AgentSSEEvent] = Field(default_factory=list)
    last_seq: int = 0


class TurnRequestResponse(BaseModel):
    """由运行快照与事件重建的某一轮模型请求（只读调试）。"""
    run_id: str
    index: int
    turn_seq: int
    messages: List[Dict[str, Any]]
    tools: List[Dict[str, Any]]


class GetSessionFilesResponse(BaseModel):
    """获取会话文件列表响应结构"""
    files: List[File] = Field(default_factory=list)


class FileReadRequest(BaseModel):
    """需要读取的沙箱文件请求结构"""
    filepath: str


class FileReadResponse(BaseModel):
    """需要读取的沙箱文件响应结构体"""
    filepath: str
    content: str


class ShellReadRequest(BaseModel):
    """需要读取的沙箱shell请求结构体"""
    session_id: str  # Shell会话id


class ConsoleRecord(BaseModel):
    """控制台记录模型，包含ps1、command、output"""
    ps1: str
    command: str
    output: str


class ShellReadResponse(BaseModel):
    """需要读取的沙箱shell响应结构体"""
    session_id: str
    output: str
    console_records: List[ConsoleRecord] = Field(default_factory=list)
