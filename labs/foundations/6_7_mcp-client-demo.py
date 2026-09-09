#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import sys
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

    async with Client(server_params, mode=PROTOCOL_VERSION, cache=None) as client:
        await adopt_protocol(client)
        tools = (await client.list_tools()).tools
        print("工具列表:", [tool.name for tool in tools])
        if "calculator" not in {tool.name for tool in tools}:
            raise RuntimeError("未发现 calculator 工具")

        result = await client.session.call_tool(
            "calculator", {"expression": "17 + 25"}
        )
        print("工具结果:", result)
        if result.is_error or not any(
            getattr(content, "text", "") == '{"result": 42}'
            for content in result.content
        ):
            raise RuntimeError("calculator 未返回预期结果 42")


if __name__ == "__main__":
    asyncio.run(main())
