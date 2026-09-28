#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""事件通知通道：事件提交后广播 (session_id, seq)，订阅方据此回数据库读取。

通知只是提示，不是事实源：丢失时订阅方靠兜底查询补齐，通知内容里不带事件本身。
文本增量走同一条频道，但不落库、不分配 seq；丢失后不补发。
"""
from dataclasses import dataclass
from typing import Optional, Protocol, Union


@dataclass(frozen=True)
class OutputDelta:
    """一次模型文本增量。只存在于当前 SSE 连接，刷新后不会再出现。"""
    session_id: str
    run_id: str
    turn: int  # 运行内轮次序号
    attempt: int  # 该轮内的模型请求序号
    delta: str


class EventSubscription(Protocol):

    async def get(self, timeout: float) -> Optional[Union[int, OutputDelta]]:
        """等待下一条通知。落库事件返回 seq，文本增量返回 OutputDelta；超时返回 None。"""
        ...

    async def close(self) -> None:
        ...


class EventNotifier(Protocol):

    async def publish(self, session_id: str, seq: int) -> None:
        """发布落库通知；失败时抛异常，由调用方记日志，不回滚事件。"""
        ...

    async def publish_delta(self, session_id: str, run_id: str, turn: int, attempt: int, delta: str) -> None:
        """发布文本增量。失败时抛异常，由调用方记日志，模型请求继续。"""
        ...

    async def subscribe(self, session_id: str) -> EventSubscription:
        """返回时订阅已经建立。"""
        ...
