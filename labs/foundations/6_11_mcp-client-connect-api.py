#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import os

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from mcp_client_2026 import PROTOCOL_VERSION, adopt_protocol


async def main() -> None:
    api_url = os.getenv(
        "BAIDU_MCP_URL",
        "https://qianfan.baidubce.com/v2/ai_search/mcp",
    )
    token = os.getenv("BAIDU_MCP_TOKEN")
    if not token:
        raise RuntimeError("请先设置 BAIDU_MCP_TOKEN；该外部示例不属于离线验收基线")

    async with httpx2.AsyncClient(
        headers={"Authorization": f"Bearer {token}"}
    ) as http:
        transport = streamable_http_client(api_url, http_client=http)
        async with Client(
            transport, mode=PROTOCOL_VERSION, cache=None
        ) as client:
            await adopt_protocol(client)
            print(await client.list_tools())
            result = await client.session.call_tool(
                "chatCompletions",
                {"query": "2025年广州马拉松"},
            )
            print("工具调用结果:", result)


if __name__ == "__main__":
    asyncio.run(main())
