#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""基于 Redis pub/sub 的事件通知：频道 ``session:events:{session_id}``。

落库通知的内容是 session_id 与 seq。文本增量是同一频道上的另一类载荷
（session_id、run_id、turn、attempt、delta），没有 seq。
"""
import asyncio
import json
import logging
from typing import Optional, Union

from app.domain.external.event_notifier import EventNotifier, EventSubscription, OutputDelta
from app.infrastructure.storage.redis import get_redis

logger = logging.getLogger(__name__)


def channel_name(session_id: str) -> str:
    return f"session:events:{session_id}"


class RedisEventSubscription(EventSubscription):

    def __init__(self, pubsub) -> None:
        self._pubsub = pubsub

    async def get(self, timeout: float) -> Optional[Union[int, OutputDelta]]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            message = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=remaining)
            if message is None:
                continue
            try:
                return _decode(json.loads(message["data"]))
            except (KeyError, TypeError, ValueError) as e:
                logger.warning(f"忽略无法解析的事件通知: {message!r} ({e})")

    async def close(self) -> None:
        try:
            await self._pubsub.unsubscribe()
        finally:
            await self._pubsub.aclose()


class RedisEventNotifier(EventNotifier):

    async def publish(self, session_id: str, seq: int) -> None:
        payload = json.dumps({"session_id": session_id, "seq": seq})
        await get_redis().client.publish(channel_name(session_id), payload)

    async def publish_delta(self, session_id: str, run_id: str, turn: int, attempt: int, delta: str) -> None:
        payload = json.dumps({
            "session_id": session_id,
            "run_id": run_id,
            "turn": turn,
            "attempt": attempt,
            "delta": delta,
        }, ensure_ascii=False)
        await get_redis().client.publish(channel_name(session_id), payload)

    async def subscribe(self, session_id: str) -> EventSubscription:
        pubsub = get_redis().client.pubsub()
        await pubsub.subscribe(channel_name(session_id))
        # 读到订阅确认才算建立，调用方之后的补查才能覆盖订阅前的空档
        confirmed = await pubsub.get_message(timeout=5)
        if not confirmed or confirmed.get("type") != "subscribe":
            logger.warning(f"会话[{session_id}] 事件订阅未收到确认: {confirmed!r}")
        return RedisEventSubscription(pubsub)


def _decode(payload: dict) -> Union[int, OutputDelta]:
    if "seq" in payload:
        return int(payload["seq"])
    if "delta" in payload:
        return OutputDelta(
            session_id=str(payload.get("session_id") or ""),
            run_id=str(payload.get("run_id") or ""),
            turn=int(payload["turn"]),
            attempt=int(payload["attempt"]),
            delta=str(payload.get("delta") or ""),
        )
    raise KeyError("seq")
