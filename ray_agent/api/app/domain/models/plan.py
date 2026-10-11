#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class ExecutionStatus(str, Enum):
    """规划/任务执行的状态"""
    PENDING = "pending"  # 空闲or等待中
    RUNNING = "running"  # 执行中
    COMPLETED = "completed"  # 执行完成
    FAILED = "failed"  # 失败
    LATER = "later"  # 后续阶段：已记录但本阶段不展开，不算未完成，也不算失败；仅用于计划步骤


class Step(BaseModel):
    """计划中的每一个步骤/子任务"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 子任务id
    description: str = ""  # 步骤的描述信息
    status: ExecutionStatus = ExecutionStatus.PENDING  # 子任务的执行状态
    result: Optional[str] = None  # 结果
    error: Optional[str] = None  # 错误信息
    success: bool = False  # 是否执行成功
    attachments: List[str] = Field(default_factory=list)  # 附件列表信息

    @property
    def done(self) -> bool:
        """只读属性，返回步骤是否结束"""
        return self.status in [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED]

    @property
    def open(self) -> bool:
        """本阶段仍需处理：待办或进行中；后续阶段（later）不计入"""
        return self.status in [ExecutionStatus.PENDING, ExecutionStatus.RUNNING]

    @property
    def deferred(self) -> bool:
        """属于后续阶段，尚未展开"""
        return self.status == ExecutionStatus.LATER


class Plan(BaseModel):
    """规划Domain模型，用于存储用户传递消息拆分出来的子任务/子步骤"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # 计划id
    title: str = ""  # 任务标题
    goal: str = ""  # 任务目标
    language: str = ""  # 工作语言
    steps: List[Step] = Field(default_factory=list)  # 步骤列表/子任务列表
    message: str = ""  # AI传递的消息
    status: ExecutionStatus = ExecutionStatus.PENDING  # 规划的状态
    error: Optional[str] = None  # 错误信息

    @property
    def done(self) -> bool:
        """只读属性，用于判断计划是否结束"""
        return self.status in [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED]

    def get_next_step(self) -> Optional[Step]:
        """获取需要执行的下一个步骤"""
        return next((step for step in self.steps if step.open), None)
