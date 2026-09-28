#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""事件通知通道：事件提交后广播 (session_id, seq)，订阅方据此回数据库读取。

通知只是提示，不是事实源：丢失时订阅方靠兜底查询补齐，通知内容里不带事件本身。
W6 的流式增量复用这条通道，增量不落库。
"""
from typing import Optional, Protocol


class EventSubscription(Protocol):

    async def get(self, timeout: float) -> Optional[int]:
        """等待下一条通知，返回其中的 seq；超时返回 None。"""
        ...

    async def close(self) -> None:
        ...


class EventNotifier(Protocol):

    async def publish(self, session_id: str, seq: int) -> None:
        """发布通知；失败时抛异常，由调用方记日志，不回滚事件。"""
        ...

    async def subscribe(self, session_id: str) -> EventSubscription:
        """返回时订阅已经建立。"""
        ...
