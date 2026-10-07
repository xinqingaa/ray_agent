"""单进程上下文操作状态；读取不等待摘要所持有的会话锁。"""
import asyncio
import weakref
from contextlib import asynccontextmanager
from datetime import datetime

from app.application.errors.exceptions import ConflictError
from app.infrastructure.external.message_queue.catalog_notifier import publish_catalog

_operations = weakref.WeakKeyDictionary()


def operations():
    return _operations.setdefault(asyncio.get_running_loop(), {})


def context_operation(session_id: str) -> dict:
    return operations().get(session_id, {"status": "idle", "started_at": None}).copy()


def ensure_context_idle(session_id: str) -> None:
    if session_id in operations():
        raise ConflictError("上下文正在压缩，请等待操作结束后再试")


@asynccontextmanager
async def compacting(session_id: str):
    ensure_context_idle(session_id)
    operations()[session_id] = {"status": "compacting", "started_at": datetime.now()}
    await publish_catalog({("session", session_id)})
    try:
        yield
    finally:
        operations().pop(session_id, None)
        await publish_catalog({("session", session_id)})
