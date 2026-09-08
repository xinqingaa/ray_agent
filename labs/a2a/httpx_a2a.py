#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/08 0:55
@Author  : thezehui@gmail.com
@File    : httpx_a2a.py
"""
import uuid

import httpx


async def main() -> None:
    base_url = "http://127.0.0.1:9999"
    query = "ray-agent-lab"
    async with httpx.AsyncClient(
        timeout=30,
        headers={"A2A-Version": "1.0"},
    ) as httpx_client:
        agent_card_response = await httpx_client.get(
            f"{base_url}/.well-known/agent-card.json"
        )
        agent_card_response.raise_for_status()
        print("Agent Card:", agent_card_response.json())

        agent_card = agent_card_response.json()
        interfaces = agent_card.get("supportedInterfaces") or []
        jsonrpc = next(
            (
                item for item in interfaces
                if item.get("protocolBinding") == "JSONRPC"
                and item.get("protocolVersion") == "1.0"
            ),
            None,
        )
        if jsonrpc is None:
            raise RuntimeError("Agent Card 未公布 A2A 1.0 JSON-RPC 接口")

        request_body = {
            "id": str(uuid.uuid4()),
            "jsonrpc": "2.0",
            "method": "SendMessage",
            "params": {
                "message": {
                    "messageId": str(uuid.uuid4()),
                    "role": "ROLE_USER",
                    "parts": [{"text": query}],
                },
                "configuration": {},
            },
        }
        agent_response = await httpx_client.post(
            jsonrpc["url"], json=request_body
        )
        agent_response.raise_for_status()
        payload = agent_response.json()
        print("Response:", payload)
        if "error" in payload:
            raise RuntimeError(f"A2A JSON-RPC 错误: {payload['error']}")
        parts = payload.get("result", {}).get("message", {}).get("parts", [])
        expected = f"A2A_LAB_OK:{query}"
        if expected not in [part.get("text") for part in parts]:
            raise RuntimeError(f"未收到确定性回复 {expected}")

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
