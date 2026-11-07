"""supervisor 的异步客户端：保持一条到 Unix 域套接字的长连接，按请求 id 复用并发调用。

连接断开等同于 supervisor 停止本次的全部进程：挂起的调用以 SupervisorUnavailable 失败，之后的重连只会遇到新的 supervisor，
旧 process_id 在其中不存在。
"""
import asyncio
import contextlib
import json
from typing import Any, Awaitable, Callable, Optional

STREAM_LIMIT_BYTES = 16 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0

type SocketProvider = str | Callable[[], Awaitable[str]]


class SupervisorError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SupervisorUnavailable(SupervisorError):
    """supervisor 没有运行或连接已断开。"""

    def __init__(self, message: str) -> None:
        super().__init__("unavailable", message)


class UnknownProcess(SupervisorError):
    """process_id 不属于当前 supervisor 的生命周期。"""


class SupervisorClient:
    def __init__(self, socket: SocketProvider) -> None:
        self._socket = socket
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._recv_task: Optional[asyncio.Task] = None
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id = 0
        self._connect_lock: Optional[asyncio.Lock] = None
        self._write_lock: Optional[asyncio.Lock] = None

    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing() and self._loop is asyncio.get_running_loop()

    async def _socket_path(self) -> str:
        return self._socket if isinstance(self._socket, str) else await self._socket()

    async def connect(self) -> None:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:  # 连接属于别的事件循环，丢弃旧状态
            self._reset_state()
            self._loop = loop
            self._connect_lock = asyncio.Lock()
            self._write_lock = asyncio.Lock()
        assert self._connect_lock is not None
        async with self._connect_lock:
            if self.connected:
                return
            path = await self._socket_path()
            try:
                self._reader, self._writer = await asyncio.wait_for(
                    asyncio.open_unix_connection(path, limit=STREAM_LIMIT_BYTES), CONNECT_TIMEOUT_SECONDS)
            except (OSError, asyncio.TimeoutError) as exc:
                raise SupervisorUnavailable(f"无法连接执行 supervisor: {exc}") from exc
            self._recv_task = asyncio.create_task(self._receive(self._reader))

    def _reset_state(self) -> None:
        self._reader = self._writer = self._recv_task = None
        self._pending = {}

    async def _receive(self, reader: asyncio.StreamReader) -> None:
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                future = self._pending.pop(message.get("id"), None)
                if future is not None and not future.done():
                    future.set_result(message)
        except (OSError, asyncio.LimitOverrunError, ValueError):
            pass
        finally:
            self._fail_pending("执行 supervisor 连接已断开")
            if self._reader is reader and self._writer is not None:
                self._writer.close()

    def _fail_pending(self, reason: str) -> None:
        pending, self._pending = self._pending, {}
        for future in pending.values():
            if not future.done():
                future.set_exception(SupervisorUnavailable(reason))

    async def call(self, method: str, params: Optional[dict[str, Any]] = None,
                   timeout: Optional[float] = None) -> dict[str, Any]:
        if not self.connected:
            await self.connect()
        assert self._writer is not None and self._write_lock is not None
        self._next_id += 1
        request_id = self._next_id
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        data = (json.dumps({"id": request_id, "method": method, "params": params or {}},
                           ensure_ascii=False) + "\n").encode("utf-8")
        try:
            async with self._write_lock:
                self._writer.write(data)
                await self._writer.drain()
            message = await asyncio.wait_for(future, timeout)
        except (ConnectionError, OSError) as exc:
            raise SupervisorUnavailable(f"写入执行 supervisor 失败: {exc}") from exc
        finally:
            self._pending.pop(request_id, None)
        error = message.get("error")
        if error:
            code = error.get("code", "internal")
            cls = UnknownProcess if code == "unknown_process" else SupervisorError
            raise cls(code, error.get("message", ""))
        return message.get("result") or {}

    async def close(self) -> None:
        """只关闭本客户端的连接；supervisor 随最后一条附着连接断开而停止其全部进程。"""
        writer, task = self._writer, self._recv_task
        self._writer = None
        if writer is not None:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._fail_pending("执行 supervisor 连接已关闭")
