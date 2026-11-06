"""进程内通知：事件提交后的 (session_id, seq)、文本增量与会话目录变化。

通知只用于唤醒订阅方，不是事实源：订阅方收到通知或等待超时后都按序号回数据库补读，订阅队列满时丢弃最旧的通知。
"""
import asyncio
import logging
from typing import Any, Dict, Iterable, Optional, Set, Tuple, Union

from app.domain.external.event_notifier import EventNotifier, EventSubscription, OutputDelta

logger = logging.getLogger(__name__)

QUEUE_SIZE = 256


class _Subscription:
    def __init__(self, hub: "_Hub", key: str) -> None:
        self._hub, self._key = hub, key
        self.queue: asyncio.Queue = asyncio.Queue(QUEUE_SIZE)

    def offer(self, item: Any) -> None:
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(item)

    async def get(self, timeout: float) -> Optional[Any]:
        try:
            return await asyncio.wait_for(self.queue.get(), timeout)
        except asyncio.TimeoutError:
            return None

    async def close(self) -> None:
        self._hub.remove(self._key, self)


class _Hub:
    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[_Subscription]] = {}

    def subscribe(self, key: str) -> _Subscription:
        subscription = _Subscription(self, key)
        self._subscribers.setdefault(key, set()).add(subscription)
        return subscription

    def remove(self, key: str, subscription: _Subscription) -> None:
        subscribers = self._subscribers.get(key)
        if subscribers is not None:
            subscribers.discard(subscription)
            if not subscribers:
                self._subscribers.pop(key, None)

    def publish(self, key: str, item: Any) -> None:
        for subscription in list(self._subscribers.get(key, ())):
            subscription.offer(item)


class LocalEventNotifier(EventNotifier):

    def __init__(self, hub: Optional[_Hub] = None) -> None:
        self._hub = hub or _Hub()

    async def publish(self, session_id: str, seq: int) -> None:
        self._hub.publish(session_id, seq)

    async def publish_delta(self, session_id: str, run_id: str, turn: int, attempt: int, delta: str) -> None:
        self._hub.publish(session_id, OutputDelta(session_id=session_id, run_id=run_id, turn=turn, attempt=attempt,
                                                  delta=delta))

    async def subscribe(self, session_id: str) -> EventSubscription:
        return self._hub.subscribe(session_id)


CatalogHint = Tuple[str, str]


class CatalogNotifier:
    """会话目录变化：载荷只有种类与 id，列表流据此重新查询。"""

    def __init__(self) -> None:
        self._hub = _Hub()

    def publish(self, hints: Iterable[CatalogHint]) -> None:
        for kind, item_id in {(kind, item_id) for kind, item_id in hints if item_id}:
            self._hub.publish("catalog", {"kind": kind, "id": str(item_id)})

    def subscribe(self) -> _Subscription:
        return self._hub.subscribe("catalog")


_events: Optional[LocalEventNotifier] = None
_catalog: Optional[CatalogNotifier] = None


def event_notifier() -> LocalEventNotifier:
    global _events
    if _events is None:
        _events = LocalEventNotifier()
    return _events


def catalog_notifier() -> CatalogNotifier:
    global _catalog
    if _catalog is None:
        _catalog = CatalogNotifier()
    return _catalog
