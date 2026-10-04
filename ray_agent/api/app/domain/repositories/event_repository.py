#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话事件仓库：数据库是事件的事实源，按会话内序号保存。"""
from typing import List, Optional, Protocol, Sequence

from app.domain.models.event import BaseEvent, Event


class EventRepository(Protocol):

    async def add(self, session_id: str, event: BaseEvent) -> int:
        """在当前事务内追加事件，seq 取会话内最大值加一，主键冲突时重试；写回 event.seq 并返回。"""
        ...

    async def list(
            self,
            session_id: str,
            after_seq: int = 0,
            limit: Optional[int] = None,
            types: Optional[Sequence[str]] = None,
            run_id: Optional[str] = None,
    ) -> List[Event]:
        """按 seq 升序读取 seq > after_seq 的事件，可按类型与运行过滤。"""
        ...

    async def first_user_message(self, session_id: str) -> Optional[Event]:
        ...

    async def max_seq(self, session_id: str) -> int:
        """会话当前最大 seq，没有事件时为 0。"""
        ...
