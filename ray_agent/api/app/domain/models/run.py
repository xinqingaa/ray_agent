#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""运行：一条用户消息触发的一次 Agent 执行，有独立身份与明确终态。"""
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    """运行状态。running/waiting 是活动状态，其余是终态，终态不可再改。"""
    RUNNING = "running"  # 执行协程在运行
    WAITING = "waiting"  # 等待用户回复提问（原因为空），或等待审批（原因 approval）
    COMPLETED = "completed"  # 循环正常结束，得到最终回复；不表示目标达成
    FAILED = "failed"  # 预算、上下文、截断或未处理异常
    CANCELLED = "cancelled"  # 用户停止
    INTERRUPTED = "interrupted"  # API 进程在运行中退出，启动扫描写入

    @property
    def active(self) -> bool:
        return self in ACTIVE_RUN_STATUSES

    @property
    def terminal(self) -> bool:
        return not self.active


ACTIVE_RUN_STATUSES = frozenset({RunStatus.RUNNING, RunStatus.WAITING})


class RunReason:
    """运行原因代码；失败原因与循环的 RunEndReason 取值一致。"""
    MAX_ITERATIONS = "max_iterations"
    CONTEXT_LIMIT = "context_limit"  # 压缩后仍放不进窗口、摘要请求失败，或服务端拒绝超长输入且压缩无效
    OUTPUT_TRUNCATED = "output_truncated"
    MODEL_ERROR = "model_error"
    RUNNER_ERROR = "runner_error"  # 运行器未处理的异常
    USER_STOP = "user_stop"
    API_RESTART = "api_restart"
    RUNNER_LOST = "runner_lost"  # 数据库里仍是 running，但本进程已没有执行协程
    APPROVAL = "approval"  # waiting 的原因：工具调用等待用户批准或拒绝


class RunSummary(BaseModel):
    """运行汇总：终态 run 事件附带；模型请求与 tokens 等于各轮 turn 事件与 compact 事件（摘要请求）之和。"""
    duration_ms: Optional[int] = None
    turns: int = 0
    model_requests: int = 0
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: Optional[int] = None


class Run(BaseModel):
    """运行领域模型。计数字段在写入 turn / tool 事件的同一事务里累加。"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    status: RunStatus = RunStatus.RUNNING
    reason: Optional[str] = None
    started_at: datetime = Field(default_factory=datetime.now)
    ended_at: Optional[datetime] = None
    turns: int = 0
    model_requests: int = 0
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: Optional[int] = None
    config_snapshot: Dict[str, Any] = Field(default_factory=dict)

    def summary(self, ended_at: Optional[datetime] = None) -> RunSummary:
        end = ended_at or self.ended_at
        duration = int((end - self.started_at).total_seconds() * 1000) if end else None
        return RunSummary(
            duration_ms=duration,
            turns=self.turns,
            model_requests=self.model_requests,
            tool_calls=self.tool_calls,
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            cached_tokens=self.cached_tokens,
        )


def tools_for_turn(snapshot: Dict[str, Any], index: int) -> List[Dict[str, Any]]:
    """取第 index 轮使用的工具 schema：续接时工具集变化会追加一条 revision。"""
    tools = snapshot.get("tools") or []
    for revision in snapshot.get("tool_revisions") or []:
        if revision.get("from_turn", 0) <= index:
            tools = revision.get("tools") or []
    return tools
