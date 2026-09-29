#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict

from pydantic import BaseModel, Field

from .file import File
from .memory import Memory


class SessionStatus(str, Enum):
    """会话状态：最新运行状态的冗余副本，与运行状态在同一事务更新，供会话列表使用。"""
    PENDING = "pending"  # 尚无运行
    RUNNING = "running"  # 运行中
    WAITING = "waiting"  # 等待人类响应
    COMPLETED = "completed"  # 最新运行正常结束
    FAILED = "failed"  # 最新运行失败，同一会话可再发消息
    CANCELLED = "cancelled"  # 最新运行被用户停止
    INTERRUPTED = "interrupted"  # 最新运行因 API 重启中断


DEFAULT_SESSION_TITLE = "新对话"  # 创建会话时的占位标题，Agent 循环首次运行时替换


class Session(BaseModel):
    """会话领域模型；事件与运行分别存放在 events、runs 表，不在会话行上。"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 会话id
    sandbox_id: Optional[str] = None  # 沙箱id
    task_id: Optional[str] = None  # 任务id
    title: str = ""  # 标题
    title_source: str = "placeholder"  # placeholder / provisional / auto / manual
    unread_message_count: int = 0  # 未读消息数
    latest_message: str = ""  # 最新消息
    latest_message_at: Optional[datetime] = None  # 最新消息时间
    files: List[File] = Field(default_factory=list)  # 文件列表
    memories: Dict[str, Memory] = Field(default_factory=dict)  # 记忆
    status: SessionStatus = SessionStatus.PENDING  # 状态
    updated_at: datetime = Field(default_factory=datetime.now)  # 更新时间
    created_at: datetime = Field(default_factory=datetime.now)  # 创建时间
