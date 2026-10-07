"""目录变更通知：频道 ``catalog:changed``。

载荷只有种类和 id，不带列表正文。丢失时列表流靠兜底查询补齐，页面切回时再核对一次。
"""
import asyncio
import json
import logging
from typing import Optional

from app.infrastructure.storage.redis import get_redis

logger = logging.getLogger(__name__)

CATALOG_CHANNEL = "catalog:changed"
CATALOG_FALLBACK_SECONDS = 30.0


class CatalogSubscription:
    def __init__(self, pubsub) -> None:
        self._pubsub = pubsub

    async def get(self, timeout: float) -> Optional[dict]:
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
                payload = json.loads(message["data"])
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning(f"忽略无法解析的目录通知: {message!r} ({exc})")
                continue
            if payload.get("kind") in ("session", "project") and payload.get("id"):
                return {"kind": payload["kind"], "id": str(payload["id"])}

    async def close(self) -> None:
        try:
            await self._pubsub.unsubscribe()
        finally:
            await self._pubsub.aclose()


async def publish_catalog(hints) -> None:
    """发布失败只记日志，不回滚已经提交的写入。"""
    pending = {(kind, item_id) for kind, item_id in hints if kind in ("session", "project") and item_id}
    if not pending:
        return
    try:
        client = get_redis().client
    except Exception as exc:
        logger.debug(f"目录通知跳过: {exc}")
        return
    try:
        for kind, item_id in pending:
            await client.publish(CATALOG_CHANNEL, json.dumps({"kind": kind, "id": item_id}))
    except Exception as exc:
        logger.warning(f"目录通知发布失败: {exc}")


async def subscribe_catalog() -> Optional[CatalogSubscription]:
    try:
        pubsub = get_redis().client.pubsub()
        await pubsub.subscribe(CATALOG_CHANNEL)
    except Exception as exc:
        logger.warning(f"订阅目录通知失败，列表流改为定时兜底: {exc}")
        return None
    confirmed = await pubsub.get_message(timeout=5)
    if not confirmed or confirmed.get("type") != "subscribe":
        logger.warning(f"目录订阅未收到确认: {confirmed!r}")
    return CatalogSubscription(pubsub)
