#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""基于 Redis pub/sub 的事件通知：频道 ``session:events:{session_id}``，内容只有 session_id 与 seq。"""
import asyncio
import json
import logging
from typing import Optional

from app.domain.external.event_notifier import EventNotifier, EventSubscription
from app.infrastructure.storage.redis import get_redis

logger = logging.getLogger(__name__)


def channel_name(session_id: str) -> str:
    return f"session:events:{session_id}"


class RedisEventSubscription(EventSubscription):

    def __init__(self, pubsub) -> None:
        self._pubsub = pubsub

    async def get(self, timeout: float) -> Optional[int]:
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
                return int(json.loads(message["data"])["seq"])
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

    async def subscribe(self, session_id: str) -> EventSubscription:
        pubsub = get_redis().client.pubsub()
        await pubsub.subscribe(channel_name(session_id))
        # 读到订阅确认才算建立，调用方之后的补查才能覆盖订阅前的空档
        confirmed = await pubsub.get_message(timeout=5)
        if not confirmed or confirmed.get("type") != "subscribe":
            logger.warning(f"会话[{session_id}] 事件订阅未收到确认: {confirmed!r}")
        return RedisEventSubscription(pubsub)
