"""事件流正常完成、服务器停止、客户端断连与异常的 ASGI 收尾。"""
import asyncio
from types import SimpleNamespace

import pytest
from sse_starlette import sse

from app.interfaces.streaming import EventStreamResponse

SCOPE = {"type": "http", "method": "GET", "path": "/events", "headers": []}


@pytest.mark.parametrize("end", ["complete", "shutdown", "disconnect", "error", "cancel"])
def test_stream_finishes_only_a_connected_successful_response(monkeypatch, end):
    server = SimpleNamespace(should_exit=False)
    monkeypatch.setattr(sse, "_get_uvicorn_server", lambda: server)
    monkeypatch.setattr(sse.AppStatus, "should_exit", False)

    async def scenario():
        ready, closed = asyncio.Event(), asyncio.Event()
        messages = []

        async def events():
            try:
                yield {"event": "ready", "data": "ok"}
                if end == "complete":
                    return
                if end == "error":
                    raise ValueError("stream failed")
                await asyncio.Event().wait()
            finally:
                closed.set()

        async def receive():
            await ready.wait()
            if end == "disconnect":
                return {"type": "http.disconnect"}
            await asyncio.Event().wait()

        async def send(message):
            messages.append(message)
            if message["type"] == "http.response.body" and message.get("more_body"):
                ready.set()
                if end == "shutdown":
                    server.should_exit = True

        task = asyncio.create_task(EventStreamResponse(events(), ping=0)(SCOPE, receive, send))
        if end == "cancel":
            await ready.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        elif end == "error":
            with pytest.raises(ValueError, match="stream failed"):
                await task
        else:
            await asyncio.wait_for(task, timeout=2)
        assert closed.is_set(), "停止或断连也必须回收生成器"
        endings = [message for message in messages if message["type"] == "http.response.body"
                   and not message.get("more_body", False)]
        assert len(endings) == (1 if end in ("complete", "shutdown") else 0)
        if endings:
            assert messages[-1] == endings[0]

    asyncio.run(scenario())
