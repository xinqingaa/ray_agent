#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/26 23:48
@Author  : thezehui@gmail.com
@File    : 6_10_mcp-external-api.py
"""
import json
import os

import dotenv
import requests
from mcp.server.fastmcp import FastMCP

dotenv.load_dotenv()

mcp = FastMCP(name="三方API")

# 应用配置信息（本地 .env，已被 gitignore）
APP_ID = os.getenv("LLMOPS_APP_ID", "xxxx")
LLMOPS_API = os.getenv("LLMOPS_API", "https://llmops.shortvar.com/api/openapi/chat")
LLMOPS_API_KEY = os.getenv("LLMOPS_API_KEY", "xxxx")


@mcp.tool()
async def call_llmops_agent(query: str) -> str:
    """调用外部Agent实现对query的回答，这个Agent支持天气查询、网络内容搜索、获取当前时间等。

    Args:
        query: 用户需要提问的问题。

    Returns:
        外部Agent对query生成的最终答案。
    """
    answer = ""
    with requests.request(
            "POST",
            LLMOPS_API,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {LLMOPS_API_KEY}"
            },
            json={
                "query": query,
                "app_id": APP_ID,
                "stream": True
            }
    ) as resp:
        for line in resp.iter_lines(decode_unicode=True):
            if line:
                if line.startswith("data:"):
                    data = line.lstrip("data:").strip()
                    resp_obj = json.loads(data)
                    if resp_obj.get("event", None) == "agent_message":
                        answer += resp_obj.get("answer", "")

    return answer.strip()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
