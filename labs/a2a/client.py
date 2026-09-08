#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/07 17:47
@Author  : thezehui@gmail.com
@File    : client.py
"""
import httpx
import uuid
from a2a.client import ClientConfig, ClientFactory
from a2a.client.card_resolver import A2ACardResolver
from a2a.types import a2a_pb2 as types
from google.protobuf.json_format import MessageToDict


async def main() -> None:
    base_url = "http://127.0.0.1:9999"
    query = "ray-agent-lab"
    async with httpx.AsyncClient(
        timeout=30,
        headers={"A2A-Version": "1.0"},
    ) as http:
        card = await A2ACardResolver(http, base_url).get_agent_card()
        print("Agent Card:", MessageToDict(card))

        client = ClientFactory(ClientConfig(
            streaming=False,
            polling=False,
            httpx_client=http,
            supported_protocol_bindings=["JSONRPC"],
            use_client_preference=True,
        )).create(card)
        request = types.SendMessageRequest(
            message=types.Message(
                message_id=str(uuid.uuid4()),
                role=types.ROLE_USER,
                parts=[types.Part(text=query)],
            )
        )
        replies = []
        async for response in client.send_message(request):
            print("Response:", MessageToDict(response))
            if response.HasField("message"):
                replies.extend(
                    part.text for part in response.message.parts
                    if part.HasField("text")
                )
        expected = f"A2A_LAB_OK:{query}"
        if expected not in replies:
            raise RuntimeError(f"未收到确定性回复 {expected}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
