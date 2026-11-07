"""事件流的 ASGI 收尾：服务停止取消推送后，仍为已连接的客户端结束响应。"""
from sse_starlette import EventSourceResponse
from starlette.types import Message, Receive, Scope, Send


class EventStreamResponse(EventSourceResponse):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        started = completed = disconnected = False

        async def track_receive() -> Message:
            nonlocal disconnected
            message = await receive()
            if message["type"] == "http.disconnect":
                disconnected = True
            return message

        async def track_send(message: Message) -> None:
            nonlocal started, completed
            await send(message)
            if message["type"] == "http.response.start":
                started = True
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                completed = True

        await super().__call__(scope, track_receive, track_send)
        # sse-starlette 在服务器停止时取消发送任务，正常返回却未必发送最后一个 body。
        # 只补齐正常返回且仍连接的 HTTP 响应；断连、发送失败和外部取消不在这里重试。
        if scope["type"] == "http" and started and not completed and not disconnected:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
