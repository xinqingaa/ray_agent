"""写入临时的模型连接配置文件，并按仓库加载时的方式接到 LLMConfig 上。"""
import os
from pathlib import Path

from app.domain.models.app_config import LLMConfig
from app.infrastructure.repositories.db_app_config_repository import apply_model_connections, default_app_config


def write_connections(path: Path, text: str, mode: int = 0o600) -> None:
    path.write_text(text, encoding="utf-8")
    os.chmod(path, mode)


def connect(llm: LLMConfig, path: Path, text: str) -> LLMConfig:
    write_connections(path, text)
    app_config = default_app_config()
    app_config.llm_config = llm
    return apply_model_connections(app_config).llm_config


def providers(deepseek_key: str = "sk-deepseek", gpt_url: str = "https://gpt.test/v1", gpt_key: str = "sk-gpt",
              protocol: str = "responses") -> str:
    return f'''
[providers.deepseek]
base_url = "https://api.deepseek.com"
api_key = "{deepseek_key}"
models = ["deepseek-flash", "deepseek-v4-pro"]

[providers.gpt]
base_url = "{gpt_url}"
api_key = "{gpt_key}"
protocol = "{protocol}"
models = ["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra"]
'''
