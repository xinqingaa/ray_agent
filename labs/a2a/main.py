#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/07 15:08
@Author  : thezehui@gmail.com
@File    : agent_executor.py
"""
import uvicorn
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import a2a_pb2 as types
from starlette.applications import Starlette

from agent_executor import LabAgentExecutor

if __name__ == "__main__":
    skill = types.AgentSkill(
        id="deterministic-echo",
        name="确定性回复",
        description="返回 A2A_LAB_OK:原文，用于复现协议调用闭环。",
        tags=["验收", "echo"],
        examples=["ray-agent-lab"],
    )

    agent_card = types.AgentCard(
        name="RayAgent A2A 1.0 实验 Agent",
        description="默认返回确定性 A2A_LAB_OK 回复，可选连接 DeepSeek。",
        version="1.0",
        supported_interfaces=[types.AgentInterface(
            url="http://127.0.0.1:9999/",
            protocol_binding="JSONRPC",
            protocol_version="1.0",
        )],
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=types.AgentCapabilities(streaming=False),
        skills=[skill],
    )

    request_handler = DefaultRequestHandler(
        agent_executor=LabAgentExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=agent_card,
    )
    app = Starlette(routes=[
        *create_agent_card_routes(agent_card),
        *create_jsonrpc_routes(request_handler, rpc_url="/"),
    ])
    uvicorn.run(app, host="127.0.0.1", port=9999)
