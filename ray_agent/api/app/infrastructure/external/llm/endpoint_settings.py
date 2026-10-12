"""将配置中的环境变量引用解析为运行时端点；凭据不持久化。"""
import logging
from functools import lru_cache

from pydantic import Field, ValidationError, create_model
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.models.app_config import LLMConfig
from app.domain.models.llm_endpoints import LlmEndpoint

logger = logging.getLogger(__name__)


@lru_cache(maxsize=32)
def _environment_type(names: tuple[str, ...]) -> type[BaseSettings]:
    """只缓存字段结构。每次实例化仍重新读取进程环境和当前目录 .env。"""
    return create_model(
        "LlmEndpointEnvironment", __base__=BaseSettings,
        __config__=SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore"),
        **{f"value_{i}": (str | None, Field(default=None, validation_alias=name)) for i, name in enumerate(names)},
    )


def load_llm_endpoints(config: LLMConfig) -> dict[str, LlmEndpoint | None]:
    names = tuple(sorted({name for endpoint in config.llm_endpoints.values()
                          for name in (endpoint.url_env, endpoint.key_env)}))
    loaded = _environment_type(names)()
    values = {name: getattr(loaded, f"value_{i}") for i, name in enumerate(names)}
    endpoints: dict[str, LlmEndpoint | None] = {}
    for name, reference in config.llm_endpoints.items():
        url = (values[reference.url_env] or "").strip()
        raw_key = values[reference.key_env]
        key = (raw_key or "").strip()
        # 兼容旧全局 DeepSeek 配置；显式清空密钥不能回退到之前的值。
        if name == "deepseek" and reference.url_env == "DEEPSEEK_URL":
            url = url or str(config.base_url)
            if reference.key_env == "DEEPSEEK_API_KEY" and raw_key is None:
                key = config.api_key.strip()
        endpoints[name] = None
        if url:
            try:
                endpoints[name] = LlmEndpoint(base_url=url, api_key="" if key == "xxxx" else key)
            except ValidationError:
                # 不记录原始 URL 或异常内容，避免配置中误填的凭据进入日志。
                logger.warning("模型端点 %s 的 URL 不合法，该端点不可用", name)
    return endpoints
