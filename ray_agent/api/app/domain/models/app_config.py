#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/16 11:38
@Author  : thezehui@gmail.com
@File    : app_config.py
"""
import uuid
from enum import Enum
from typing import Dict, Optional, List, Any

from pydantic import BaseModel, HttpUrl, Field, ConfigDict, model_validator


class LLMConfig(BaseModel):
    """LLM提供商配置"""
    base_url: HttpUrl = "https://api.deepseek.com"  # 模型基础URL地址
    api_key: str = ""  # 模型API秘钥
    model_name: str = "deepseek-reasoner"  # 模型名字，默认使用deepseek-reasoner带推理的模型，传递tools会自动切换到deepseek-chat
    temperature: float = Field(0.7)  # 温度，默认设置为0.7
    max_tokens: int = Field(8192, ge=0)  # 最大输出token数，默认设置为deepseek-chat模型的最大输出限制


class AgentConfig(BaseModel):
    """Agent通用配置"""
    max_iterations: int = Field(default=100, gt=0, lt=1000)  # Agent最大迭代次数
    max_retries: int = Field(default=3, gt=1, lt=10)  # 最大重试次数
    max_search_results: int = Field(default=10, gt=1, lt=30)  # 最大搜索结果条数


class ProtocolTimeouts(BaseModel):
    """秒；发现和调用均为总预算，不能被分页或轮询重置。"""
    model_config = ConfigDict(extra="forbid")
    connect_timeout: float = Field(default=10, gt=0, le=300)
    discovery_timeout: float = Field(default=15, gt=0, le=300)
    call_timeout: float = Field(default=120, gt=0, le=3600)


class MCPTransport(str, Enum):
    STDIO = "stdio"
    STREAMABLE_HTTP = "streamable_http"


class MCPServerConfig(ProtocolTimeouts):
    transport: MCPTransport = MCPTransport.STREAMABLE_HTTP
    enabled: bool = True
    description: Optional[str] = None
    env: Dict[str, str] = Field(default_factory=dict)
    command: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    url: Optional[HttpUrl] = None
    headers: Dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_transport(self):
        if self.transport == MCPTransport.STDIO and not self.command:
            raise ValueError("stdio 必须提供 command")
        if self.transport == MCPTransport.STREAMABLE_HTTP and not self.url:
            raise ValueError("streamable_http 必须提供 HTTP(S) url")
        return self


class MCPConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mcpServers: Dict[str, MCPServerConfig] = Field(default_factory=dict)
    discovery_budget: float = Field(default=20, gt=0, le=300)


class A2AServerConfig(ProtocolTimeouts):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    base_url: HttpUrl
    enabled: bool = True
    headers: Dict[str, str] = Field(default_factory=dict)
    call_timeout: float = Field(default=600, gt=0, le=3600)
    cancel_timeout: float = Field(default=5, gt=0, le=30)


class A2AConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    a2a_servers: List[A2AServerConfig] = Field(default_factory=list)
    discovery_budget: float = Field(default=20, gt=0, le=300)


class AppConfig(BaseModel):
    """应用配置信息，包含Agent配置、LLM提供商配置、MCP配置、A2A配置"""
    llm_config: LLMConfig  # 语言模型配置
    agent_config: AgentConfig  # Agent通用配置
    mcp_config: MCPConfig  # MCP服务配置
    a2a_config: A2AConfig  # A2A服务配置

    # Pydantic配置，允许传递额外的字段初始化
    model_config = ConfigDict(extra="allow")
