#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import sys
from contextlib import AsyncExitStack
from pathlib import Path

from mcp import Client, StdioServerParameters

from mcp_client_2026 import PROTOCOL_VERSION, adopt_protocol


async def main() -> None:
    server_script = Path(__file__).with_name("6_6_mcp-server-demo.py")
    server_params = StdioServerParameters(
        command=sys.executable,
        args=[str(server_script)],
        env={},
    )

    exit_stack = AsyncExitStack()
    try:
        client = await exit_stack.enter_async_context(
            Client(server_params, mode=PROTOCOL_VERSION, cache=None)
        )
        await adopt_protocol(client)
        tools = (await client.list_tools()).tools
        print("工具列表:", [tool.name for tool in tools])

        result = await client.session.call_tool("calculator", {"expression": "6 * 7"})
        print("工具结果:", result)
        if result.is_error or not any(
            getattr(content, "text", "") == '{"result": 42}'
            for content in result.content
        ):
            raise RuntimeError("ExitStack 示例未返回预期结果 42")
    finally:
        await exit_stack.aclose()


if __name__ == "__main__":
    asyncio.run(main())
