#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""进程内的会话锁：串行化“决定消息去向”与“运行收尾”，避免补充消息落在已结束的运行里。

只在单进程内有效；多实例执行所有权不在本阶段范围内。
"""
import asyncio
import weakref
from typing import Dict

_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[str, asyncio.Lock]]" = weakref.WeakKeyDictionary()


def session_lock(session_id: str) -> asyncio.Lock:
    """同一事件循环内同一会话共用一把锁；按事件循环区分，测试里每个 asyncio.run 互不影响。"""
    locks = _locks.setdefault(asyncio.get_running_loop(), {})
    return locks.setdefault(session_id, asyncio.Lock())
