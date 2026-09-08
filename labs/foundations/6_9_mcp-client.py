#!/usr/bin/env python
"""连接本地 6_9 服务，验证 MCP 2026-07-28 Streamable HTTP。"""
import asyncio

from mcp import Client

from mcp_client_2026 import PROTOCOL_VERSION, adopt_protocol

SERVER_URL = "http://127.0.0.1:9888/mcp"


async def main() -> None:
    async with Client(SERVER_URL, mode=PROTOCOL_VERSION, cache=None) as client:
        await adopt_protocol(client)
        tools = (await client.list_tools()).tools
        print("工具列表:", [tool.name for tool in tools])
        if "run_code" not in {tool.name for tool in tools}:
            raise RuntimeError("未发现 run_code 工具")

        result = await client.session.call_tool(
            "run_code",
            {"language": "python", "code": "print(17 + 25)"},
        )
        print("工具结果:", result)
        if result.is_error or not any(
            getattr(content, "text", "").strip() == "42"
            for content in result.content
        ):
            raise RuntimeError("run_code 未返回预期结果 42")


if __name__ == "__main__":
    asyncio.run(main())
