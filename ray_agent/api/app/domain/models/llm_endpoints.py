"""内部端点配置；不包含环境读取或用户渠道选择。"""
from typing import Literal
from pydantic import BaseModel, Field, HttpUrl

ApiProtocol = Literal['responses', 'chat_completions']


class LlmEndpointConfig(BaseModel):
    api_protocol: ApiProtocol = 'responses'
    url_env: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    key_env: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")


class LlmEndpoint(BaseModel):
    api_protocol: ApiProtocol = 'responses'
    base_url: HttpUrl
    api_key: str = Field(default="", repr=False)


def default_endpoints() -> dict[str, LlmEndpointConfig]:
    return {
        "deepseek": LlmEndpointConfig(url_env="DEEPSEEK_URL", key_env="DEEPSEEK_API_KEY"),
        "gpt": LlmEndpointConfig(url_env="XIAOYI_URL", key_env="XIAOYI_API_KEY"),
    }


def default_model_endpoints() -> dict[str, str]:
    return {
        "deepseek-flash": "deepseek", "deepseek-v4-pro": "deepseek",
        "gpt-6.1-sol": "gpt", "gpt-6-luna": "gpt", "gpt-6-astra": "gpt",
    }
