"""MCP 2026-07-28 客户端。每个连接由单一后台任务拥有其整个上下文。"""
import asyncio
import contextvars
import time
import hashlib
import logging
import os
import re
from contextlib import AsyncExitStack
from typing import Any, Callable, Optional

import httpx2
from mcp import Client, StdioServerParameters, Tool, types
import mcp.client.stdio as mcp_stdio
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError
from pydantic import ValidationError

from app.domain.models.app_config import MCPConfig, MCPServerConfig, MCPTransport
from app.domain.models.tool_result import ToolResult
from app.infrastructure.external.execution.env import scrub_env
from .common import describe_content, discover_all, failure, keep_full_content

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2026-07-28"

# stdio 子进程在 SDK 内 start_new_session；用钩子拿到 pid 交给执行 supervisor 登记回收
_stdio_spawn_hook: contextvars.ContextVar[Optional[Callable[[Any], None]]] = contextvars.ContextVar(
    "mcp_stdio_spawn_hook", default=None)
_orig_create_process = mcp_stdio._create_platform_compatible_process


async def _create_process_and_notify(*args, **kwargs):
    process = await _orig_create_process(*args, **kwargs)
    hook = _stdio_spawn_hook.get()
    if hook is not None:
        hook(process)
    return process


mcp_stdio._create_platform_compatible_process = _create_process_and_notify


def tool_name(server: str, name: str) -> str:
    readable = re.sub(r"[^a-zA-Z0-9_-]", "_", f"{server}_{name}")[:42]
    digest = hashlib.sha256(f"{server}\0{name}".encode()).hexdigest()[:16]
    return f"mcp_{readable}_{digest}"


class MCPConnection:
    def __init__(self, config: MCPServerConfig, *, owner=None, on_spawn: Callable[[int], None] | None = None):
        self.config = config
        self.owner = owner  # ProcessOwner；stdio 启动后登记到执行 supervisor
        self.on_spawn = on_spawn
        self.tools: list[Tool] = []
        self.ready = asyncio.get_running_loop().create_future()
        self.queue: asyncio.Queue = asyncio.Queue()
        self.external_pid: int | None = None
        self.task = asyncio.create_task(self._run(), name="mcp-connection-owner")

    async def _run(self):
        current = None
        try:
            # 预算作用域先进入、最后退出，SDK 的 cancel scopes 不跨 Task。
            async with asyncio.timeout(self.config.discovery_timeout) as deadline:
                async with AsyncExitStack() as stack:
                    if self.config.transport == MCPTransport.STDIO:
                        # 受控继承：不把模型密钥与冻结标记传给 MCP；配置 env 可显式覆盖
                        from app.infrastructure.external.execution.tool_runtimes import ensure_tool_runtimes
                        env = scrub_env(os.environ, await ensure_tool_runtimes(), extra=self.config.env or {})
                        params = StdioServerParameters(
                            command=self.config.command, args=self.config.args, env=env)

                        def _capture(process) -> None:
                            pid = getattr(process, "pid", None)
                            if isinstance(pid, int):
                                self.external_pid = pid
                                if self.on_spawn is not None:
                                    self.on_spawn(pid)

                        token = _stdio_spawn_hook.set(_capture)
                        try:
                            # Client(StdioServerParameters) 由 SDK 拉起子进程；钩子只登记 pid
                            client = await stack.enter_async_context(
                                Client(params, mode=PROTOCOL_VERSION, cache=None))
                        finally:
                            _stdio_spawn_hook.reset(token)
                    else:
                        http = await stack.enter_async_context(httpx2.AsyncClient(
                            headers=self.config.headers,
                            timeout=httpx2.Timeout(None, connect=self.config.connect_timeout,
                                                   write=self.config.connect_timeout, pool=self.config.connect_timeout)))
                        target = streamable_http_client(str(self.config.url), http_client=http)
                        client = await stack.enter_async_context(Client(target, mode=PROTOCOL_VERSION, cache=None))
                    # pin 只采用版本、不探测；单独发送官方新版发现方法验证对端。
                    discovery = types.DiscoverResult.model_validate(await client.session.send_discover(PROTOCOL_VERSION))
                    if PROTOCOL_VERSION not in discovery.supported_versions:
                        raise ValueError("服务器不支持 MCP 2026-07-28")
                    client.session.adopt(discovery)
                    cursor = None
                    cursors = set()
                    names = set()
                    while True:
                        page = await client.list_tools(cursor=cursor)
                        for item in page.tools:
                            if item.name in names:
                                raise ValueError("工具发现包含重复名称")
                            names.add(item.name)
                            self.tools.append(item)
                        cursor = page.next_cursor
                        if cursor is None:
                            break
                        if cursor in cursors:
                            raise ValueError("工具分页游标重复")
                        cursors.add(cursor)
                    deadline.reschedule(None)
                    self.ready.set_result(None)
                    while True:
                        name, arguments, current = await self.queue.get()
                        try:
                            async with asyncio.timeout(self.config.call_timeout):
                                # 单次发送；本产品不接续 input-required，也不自动重放副作用。
                                result = await client.session.call_tool(name, arguments, allow_input_required=True)
                            if not isinstance(result, types.CallToolResult):
                                outcome = failure("input_required", "MCP 工具需要当前产品未支持的交互")
                            else:
                                raw = result.model_dump(mode="json", by_alias=False)
                                data = describe_content(raw)
                                reason = "\n".join(item.text for item in result.content if isinstance(item, types.TextContent))
                                outcome = keep_full_content(ToolResult(success=not result.is_error,
                                    message=(reason[:2000] or "MCP 工具执行失败") if result.is_error else "MCP 工具调用完成",
                                    data={**data, "error_kind": "tool_error" if result.is_error else None}), raw)
                        except TimeoutError:
                            outcome = failure("timeout", "MCP 调用超时，远程结果未知；未自动重试")
                        except MCPError as exc:
                            outcome = failure("protocol_error", f"MCP 协议错误（{exc.code}）")
                        except (ValueError, ValidationError):
                            outcome = failure("invalid_response", "MCP 返回非法响应")
                        except Exception:
                            outcome = failure("transport_error", "MCP 连接中断，远程结果未知；未自动重试")
                        if not current.done():
                            current.set_result(outcome)
                        current = None
                        if outcome.data.get("error_kind") == "timeout":
                            break  # 退出 owner，取消仍在传输层等待的请求。
        except BaseException as exc:
            if not self.ready.done():
                self.ready.set_exception(exc)
            elif not isinstance(exc, asyncio.CancelledError):
                # 后台连接异常可由后续调用观察，不会产生未取回的 Task 异常。
                self.error = exc
                logger.error("MCP 连接 owner 异常退出: %s", type(self.error).__name__)
        finally:
            if current is not None and not current.done():
                current.set_result(failure("connection_closed", "MCP 连接已关闭，结果未知"))
            while not self.queue.empty():
                _, _, pending = self.queue.get_nowait()
                if not pending.done():
                    pending.set_result(failure("connection_closed", "MCP 连接已关闭"))

    async def call(self, name: str, arguments: dict) -> ToolResult:
        if self.task.done():
            return failure("connection_closed", "MCP 连接已关闭")
        result = asyncio.get_running_loop().create_future()
        await self.queue.put((name, arguments, result))
        try:
            return await result
        except asyncio.CancelledError:
            await self.close()
            raise

    async def close(self):
        if not self.task.done():
            self.task.cancel()
        # SDK 在 owner 中退出；调用方不持有 SDK cancel scopes。
        async with asyncio.timeout(10):
            await asyncio.shield(self.task)
        if hasattr(self, "error"):
            raise RuntimeError(f"MCP 连接异常: {type(self.error).__name__}") from self.error
        if self.ready.done() and not self.ready.cancelled():
            self.ready.exception()


class MCPClientManager:
    def __init__(self, mcp_config: MCPConfig, *, process_owner=None,
                 register_pid: Callable[[int], Any] | None = None):
        self.config = mcp_config
        self.process_owner = process_owner
        self.register_pid = register_pid
        self.tools: dict[str, list[Tool]] = {}
        self.errors: dict[str, str] = {}
        self.connections: dict[str, MCPConnection] = {}
        self.routes: dict[str, tuple[str, str]] = {}
        self.initialized = False

    async def _connect(self, name: str, config: MCPServerConfig):
        def on_spawn(pid: int) -> None:
            if self.register_pid is None:
                return
            try:
                result = self.register_pid(pid)
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception:
                logger.exception("MCP stdio 进程登记回调失败 pid=%s", pid)

        connection = MCPConnection(config, owner=self.process_owner, on_spawn=on_spawn)
        self.connections[name] = connection
        try:
            await asyncio.shield(connection.ready)
            self.tools[name] = connection.tools
            for item in connection.tools:
                alias = tool_name(name, item.name)
                if alias in self.routes:
                    raise ValueError("工具名称哈希冲突")
                self.routes[alias] = (name, item.name)
            if connection.external_pid and self.register_pid is not None:
                try:
                    result = self.register_pid(connection.external_pid)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception:
                    logger.exception("MCP stdio 进程登记失败 pid=%s", connection.external_pid)
        except BaseException as exc:
            self.errors.setdefault(name, "发现超时" if isinstance(exc, TimeoutError) else "连接或新版协议发现失败")
            await connection.close()
            self.connections.pop(name, None)
            if isinstance(exc, asyncio.CancelledError):
                raise

    async def discover(self, name):
        config = self.config.mcpServers.get(name)
        if config is None or not config.enabled:
            raise ValueError('未知或已禁用的 MCP 服务')
        if name in self.tools:
            return
        self.errors.pop(name, None)
        started = time.monotonic()
        try:
            await discover_all({name: self._connect(name, config)}, self.config.discovery_budget, self.errors)
        finally:
            logger.info('run_stage stage=mcp_discovery service=%s duration_ms=%d ready=%s',
                        name, int((time.monotonic()-started)*1000), name in self.tools)

    async def initialize(self):
        if self.initialized:
            return
        await discover_all({name: self._connect(name, config) for name, config in self.config.mcpServers.items()
                            if config.enabled and name not in self.tools}, self.config.discovery_budget, self.errors)
        self.initialized = True

    async def get_all_tools(self) -> list[dict[str, Any]]:
        return [{"type": "function", "function": {"name": tool_name(server, item.name),
                "description": f"[{server}] {item.description or item.name}", "parameters": item.input_schema}}
                for server, items in self.tools.items() for item in items]

    def route(self, name: str) -> tuple[str, str] | None:
        """工具别名对应的 (服务名, 原始工具名)，供工具策略按服务匹配。"""
        return self.routes.get(name)

    async def invoke(self, name: str, arguments: dict) -> ToolResult:
        route = self.routes.get(name)
        if route is None:
            return failure("unknown_tool", "MCP 工具不存在")
        server, original = route
        return await self.connections[server].call(original, arguments)

    async def cleanup(self):
        try:
            await asyncio.gather(*(c.close() for c in self.connections.values()))
        finally:
            self.connections.clear()
            self.tools.clear()
            self.routes.clear()
            self.errors.clear()
            self.initialized = False
