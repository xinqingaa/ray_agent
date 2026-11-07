"""模型连接：提供商的地址、密钥与协议，以及模型到提供商的映射。连接来自用户配置文件，不进业务库。"""
from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl

ApiProtocol = Literal['responses', 'chat_completions']


class LlmEndpoint(BaseModel):
    api_protocol: ApiProtocol = 'responses'
    base_url: HttpUrl
    api_key: str = Field(default="", repr=False)


class ProviderStatus(BaseModel):
    """设置页可见的提供商状态；密钥只给掩码。"""
    name: str
    base_url: Optional[str] = None
    api_protocol: ApiProtocol = 'responses'
    models: list[str] = Field(default_factory=list, description="由它提供的已知模型")
    has_key: bool = False
    key_hint: Optional[str] = None
    issue: Optional[str] = Field(default=None, description="不可用或部分忽略的原因")


class ConnectionSource(BaseModel):
    """模型连接配置文件的读取结果。"""
    path: str
    exists: bool = False
    issue: Optional[str] = Field(default=None, description="整份文件无法使用的原因")
    notices: list[str] = Field(default_factory=list, description="不影响使用的提醒")
    providers: list[ProviderStatus] = Field(default_factory=list)


def default_model_endpoints() -> dict[str, str]:
    """未读取配置文件时的映射，只用于直接构造的配置。"""
    return {
        "deepseek-flash": "deepseek", "deepseek-v4-pro": "deepseek",
        "gpt-6.1-sol": "gpt", "gpt-6-luna": "gpt", "gpt-6-astra": "gpt",
    }
