#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.domain.models.app_config import LLMConfig, ModelSampling, MCPTransport, ToolPolicy


class ModelSamplingPublic(BaseModel):
    temperature: float
    max_tokens: int
    context_window: int


class LLMConfigPublic(BaseModel):
    """设置页可见的 LLM 配置；不含密钥明文。"""
    base_url: str
    model_name: str
    temperature: float
    max_tokens: int
    context_window: int
    model_profiles: Dict[str, ModelSamplingPublic] = Field(default_factory=dict)
    has_api_key: bool = False

    @classmethod
    def from_llm(cls, llm: LLMConfig) -> "LLMConfigPublic":
        from app.domain.models.model_catalog import configured_sampling, model_list, provider_for
        key = (llm.api_key or "").strip()
        profiles: Dict[str, ModelSamplingPublic] = {}
        provider = provider_for(str(llm.base_url))
        if provider:
            for spec in model_list(provider):
                sampling = configured_sampling(llm, spec.id)
                profiles[spec.id] = ModelSamplingPublic(
                    temperature=sampling.temperature, max_tokens=sampling.max_tokens, context_window=sampling.context_window,
                )
        return cls(
            base_url=str(llm.base_url),
            model_name=llm.model_name,
            temperature=llm.temperature,
            max_tokens=llm.max_tokens,
            context_window=llm.context_window,
            model_profiles=profiles,
            has_api_key=bool(key) and key != "xxxx",
        )


class ModelCatalogItem(BaseModel):
    id: str
    context_window: int
    max_output: int
    choices: List[str]
    default_choice: str


class ModelCatalogResponse(BaseModel):
    provider: str | None = None
    models: List[ModelCatalogItem] = Field(default_factory=list)
    default_model: str | None = None


class LLMConfigUpdate(BaseModel):
    """更新 LLM 配置时忽略密钥字段。未提交的字段保持原值。"""
    model_config = ConfigDict(extra="ignore")
    base_url: HttpUrl
    model_name: str
    temperature: float = Field(0.7)
    max_tokens: int = Field(8192, ge=0)
    context_window: int = Field(131072, ge=1)
    model_profiles: Optional[Dict[str, ModelSampling]] = None


class ConnectionState(BaseModel):
    connection_status: Literal["connected", "disabled", "unavailable"]
    error: str | None = None


class ListMCPServerItem(ConnectionState):
    """MCP服务列表条目选项"""
    server_name: str = ""  # 服务名字
    enabled: bool = True  # 启用状态
    transport: MCPTransport = MCPTransport.STREAMABLE_HTTP  # 传输协议
    tools: List[str] = Field(default_factory=list)  # 工具名字列表


class ListMCPServerResponse(BaseModel):
    """获取MCP服务列表响应结构"""
    mcp_servers: List[ListMCPServerItem] = Field(default_factory=list)  # MCP服务列表


class ListA2AServerItem(ConnectionState):
    base_url: str
    """A2A服务列表条目选项"""
    id: str = ""  # id
    name: str = ""  # 名字
    description: str = ""  # 描述信息
    input_modes: List[str] = Field(default_factory=list)  # 输入模态
    output_modes: List[str] = Field(default_factory=list)  # 输出模态
    streaming: bool = False  # 是否支持流式
    push_notifications: bool = False  # 是否支持推送通知
    enabled: bool = True  # 启用状态


class ListA2AServerResponse(BaseModel):
    """获取A2A服务列表响应结构"""
    a2a_servers: List[ListA2AServerItem] = Field(default_factory=list)  # A2A服务列表


class BuiltinToolset(BaseModel):
    toolset: str  # 工具集名字，规则键可写 <toolset>:*
    functions: List[str] = Field(default_factory=list)  # 函数名，规则键可直接写函数名


class ToolPolicyUpdate(BaseModel):
    """整体替换工具策略表；键格式见 GET 响应说明与 ToolPolicyConfig。"""
    model_config = ConfigDict(extra="forbid")
    rules: Dict[str, ToolPolicy] = Field(default_factory=dict)


class ToolPolicyResponse(BaseModel):
    """工具策略表与设置页需要的参照信息。未匹配任何规则的调用为 fallback（allow）。"""
    rules: Dict[str, ToolPolicy]  # 当前规则：键 → allow / ask / deny
    default_rules: Dict[str, ToolPolicy]  # 出厂默认规则，供“恢复默认”
    fallback: ToolPolicy = ToolPolicy.ALLOW
    builtin_toolsets: List[BuiltinToolset] = Field(default_factory=list)  # 内置工具；MCP/A2A 服务见各自列表接口
