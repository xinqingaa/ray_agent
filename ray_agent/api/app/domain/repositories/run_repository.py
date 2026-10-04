#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""运行仓库：每个会话最多一个 running/waiting 运行，由部分唯一索引保证。"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol

from app.domain.models.run import Run, RunStatus


class ActiveRunExistsError(RuntimeError):
    """同一会话已存在活动运行（running 或 waiting）。"""


class RunRepository(Protocol):

    async def create(self, run: Run) -> None:
        """新建运行；会话已有活动运行时抛 ActiveRunExistsError。"""
        ...

    async def get(self, run_id: str) -> Optional[Run]:
        ...

    async def lock(self, run_id: str) -> Optional[Run]:
        """读取并对运行行加排他锁直到事务结束：同一运行的写入按此串行，终态判断与写入之间不会插入状态变化。"""
        ...

    async def get_active(self, session_id: str) -> Optional[Run]:
        """会话当前 running 或 waiting 的运行。"""
        ...

    async def get_active_project(self, project_id: str, exclude_session: Optional[str] = None) -> Optional[Run]:
        ...

    async def active_projects(self, project_ids: list[str]) -> dict[str, Run]:
        ...

    async def list_by_session(self, session_id: str) -> List[Run]:
        """按开始时间升序。"""
        ...

    async def list_by_status(self, status: RunStatus) -> List[Run]:
        ...

    async def transition(
            self,
            run_id: str,
            status: RunStatus,
            reason: Optional[str] = None,
            ended_at: Optional[datetime] = None,
    ) -> Optional[Run]:
        """只在运行仍处于活动状态时改写状态；已是终态时不改动并返回 None，否则返回更新后的运行。"""
        ...

    async def add_counters(
            self,
            run_id: str,
            turns: int = 0,
            model_requests: int = 0,
            tool_calls: int = 0,
            prompt_tokens: int = 0,
            completion_tokens: int = 0,
            cached_tokens: Optional[int] = None,
    ) -> None:
        """累加计数；cached_tokens 为 None 表示本次没有缓存数据，不把已有值改成 0。"""
        ...

    async def save_snapshot(self, run_id: str, snapshot: Dict[str, Any]) -> None:
        ...
