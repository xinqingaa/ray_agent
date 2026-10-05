#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid
from enum import Enum
from typing import Dict, Optional, List, Any

from pydantic import BaseModel, HttpUrl, Field, ConfigDict, model_validator


class LLMConfig(BaseModel):
    """LLM提供商配置"""
    base_url: HttpUrl = "https://api.deepseek.com"  # 模型基础URL地址
    api_key: str = ""  # 仅从 LLM_API_KEY 注入，不写配置文件、不返回给页面
    model_name: str = "deepseek-flash"  # 未知厂商时的模型 id；已知厂商的对话用模型目录，不读这一项
    temperature: float = Field(0.7)  # 温度，默认设置为0.7
    max_tokens: int = Field(8192, ge=0)  # 最大输出token数，默认设置为deepseek-chat模型的最大输出限制
    context_window: int = Field(65536, ge=1)  # 模型上下文窗口（输入+输出）；可用输入上限 = 窗口 − max_tokens − 安全余量
    streaming: bool = True  # 模型响应走流式并组装完整结果；false 时一次返回整包
    # 秒。非流式是整次请求的上限；流式是首个分片与相邻分片的间隔上限，不是整段生成的总时长
    request_timeout: float = Field(default=3600, gt=0, le=86400)


class AgentConfig(BaseModel):
    """Agent通用配置"""
    project_snapshot_retention: int = Field(default=5, ge=1, le=7)
    max_iterations: int = Field(default=100, gt=0, lt=1000)  # Agent最大迭代次数
    max_retries: int = Field(default=3, gt=1, lt=10)  # 最大重试次数
    max_search_results: int = Field(default=10, gt=1, lt=30)  # 最大搜索结果条数
    # 上下文治理（W2）
    context_safety_ratio: float = Field(default=0.05, ge=0, lt=0.5)  # 安全余量占窗口的比例
    compact_watermark: float = Field(default=0.75, gt=0, le=1)  # 估算超过“可用输入上限 × 该比例”时先压缩
    compact_keep_turns: int = Field(default=3, ge=1, le=20)  # 压缩时原样保留的最近轮数
    compact_user_chars: int = Field(default=16000, ge=1000)  # 压缩后重新注入的用户消息原文总字符上限
    tool_result_max_chars: int = Field(default=8000, ge=1000)  # 单条工具结果序列化后的字符上限，超出只给首尾预览


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


class ToolPolicy(str, Enum):
    """工具调用前的策略：直接执行、请求用户批准、禁止执行。"""
    ALLOW = "allow"
    ASK = "ask"
    DENY = "deny"


# 计划与提问是循环自身的控制工具，不受策略约束
POLICY_EXEMPT_TOOLSETS = frozenset({"message", "plan"})
POLICY_EXEMPT_FUNCTIONS = frozenset({"message_ask_user", "update_plan"})


def default_tool_policy_rules() -> Dict[str, ToolPolicy]:
    """默认策略：外部 MCP 服务与远程 Agent 需要批准；沙箱内的文件、Shell、浏览器、检索未列出，即 allow。"""
    return {"mcp:*": ToolPolicy.ASK, "a2a:*": ToolPolicy.ASK}


class ToolPolicyConfig(BaseModel):
    """工具策略表。规则键（从具体到宽泛，先匹配者生效）：

    - 内置工具：函数名（如 ``shell_execute``），或工具集通配 ``<工具集>:*``（如 ``shell:*``）；
    - MCP：``mcp:<服务名>:<工具名>``、``mcp:<服务名>:*``、``mcp:*``，工具名是服务端的原始名称；
    - A2A：``a2a:<远程 Agent id>:call_remote_agent``、``a2a:<id>:*``、``a2a:*``。
      ``get_remote_agent_cards`` 只读本地已发现的卡片，按内置工具处理，不受 ``a2a:*`` 约束。

    没有匹配任何规则的调用为 allow。
    """
    model_config = ConfigDict(extra="forbid")
    rules: Dict[str, ToolPolicy] = Field(default_factory=default_tool_policy_rules)

    @model_validator(mode="after")
    def validate_rules(self):
        for key in self.rules:
            name = key.strip()
            if not name or name != key or any(c.isspace() for c in key):
                raise ValueError(f"工具策略规则键不能为空或包含空白：{key!r}")
            toolset, _, rest = key.partition(":")
            if not toolset or (rest and rest != "*" and toolset not in ("mcp", "a2a")):
                raise ValueError(f"工具策略规则键格式不正确：{key!r}")
            if toolset in ("mcp", "a2a") and rest and rest != "*":
                service, _, tool_name = rest.partition(":")
                if not service or not tool_name:
                    raise ValueError(f"工具策略规则键格式不正确：{key!r}，应为 {toolset}:<服务>:<工具或*>")
            if toolset in POLICY_EXEMPT_TOOLSETS or key in POLICY_EXEMPT_FUNCTIONS:
                raise ValueError(f"计划与提问工具不受工具策略约束：{key!r}")
        return self


class AppConfig(BaseModel):
    """应用配置信息，包含Agent配置、LLM提供商配置、MCP配置、A2A配置与工具策略"""
    llm_config: LLMConfig  # 语言模型配置
    agent_config: AgentConfig  # Agent通用配置
    mcp_config: MCPConfig  # MCP服务配置
    a2a_config: A2AConfig  # A2A服务配置
    tool_policy: ToolPolicyConfig = Field(default_factory=ToolPolicyConfig)  # 工具策略表

    # Pydantic配置，允许传递额外的字段初始化
    model_config = ConfigDict(extra="allow")
