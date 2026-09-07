#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/17 10:56
@Author  : thezehui@gmail.com
@File    : file_app_config_repository.py
"""
import logging
from pathlib import Path
from typing import Optional

import yaml
from filelock import FileLock

from app.application.errors.exceptions import ServerRequestsError
from app.domain.models.app_config import AppConfig, LLMConfig, AgentConfig, MCPConfig, A2AConfig
from app.domain.repositories.app_config_repository import AppConfigRepository
from core.config import get_settings

logger = logging.getLogger(__name__)


class FileAppConfigRepository(AppConfigRepository):
    """基于本地文件的App配置数据仓库"""

    def __init__(self, config_path: str) -> None:
        """构造函数，完成文件配置仓库的相关信息初始化"""
        # 1.获取当前项目的根目录
        root_dir = Path.cwd()

        # 2.拼接配置文件路径并校验基础信息
        self._config_path = root_dir.joinpath(root_dir, config_path)
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock_file = self._config_path.with_suffix(".lock")  # 文件锁

    def _create_default_app_config_if_not_exists(self):
        """如果配置文件不存在，则使用默认配置并写入到本地文件"""
        if not self._config_path.exists():
            default_app_config = AppConfig(
                llm_config=LLMConfig(),
                agent_config=AgentConfig(),
                mcp_config=MCPConfig(),
                a2a_config=A2AConfig(),
            )
            self.save(default_app_config)

    _LLM_YAML_DEFAULTS = {
        "api_key": "",
        "model_name": "deepseek-chat",
        "base_url": "https://api.deepseek.com/",
        "temperature": 0.7,
        "max_tokens": 8192,
    }

    @staticmethod
    def _env_llm_overrides() -> dict:
        """从 .env 收集已填写的 LLM 覆盖项。"""
        settings = get_settings()
        overrides = {}

        api_key = settings.llm_api_key.strip()
        if api_key and api_key != "xxxx":
            overrides["api_key"] = api_key

        model_name = settings.llm_model_name.strip()
        if model_name:
            overrides["model_name"] = model_name

        base_url = settings.llm_base_url.strip()
        if base_url:
            overrides["base_url"] = base_url

        if settings.llm_temperature is not None:
            overrides["temperature"] = settings.llm_temperature
        if settings.llm_max_tokens is not None:
            overrides["max_tokens"] = settings.llm_max_tokens
        return overrides

    @classmethod
    def _apply_llm_env(cls, app_config: AppConfig) -> AppConfig:
        """内存中的 LLM 配置优先使用环境变量。"""
        if app_config.llm_config.api_key.strip() in {"", "xxxx"}:
            app_config.llm_config.api_key = ""
        overrides = cls._env_llm_overrides()
        if overrides:
            app_config.llm_config = app_config.llm_config.model_copy(update=overrides)
        return app_config

    @classmethod
    def _redact_llm_env(cls, data: dict, previous: Optional[dict] = None) -> dict:
        """写回 yaml 时不把 .env 覆盖值落盘。"""
        llm_config = data.get("llm_config")
        if not isinstance(llm_config, dict):
            return data

        previous_llm = previous.get("llm_config") if isinstance(previous, dict) else {}
        if not isinstance(previous_llm, dict):
            previous_llm = {}

        overrides = cls._env_llm_overrides()
        for field, value in overrides.items():
            dumped = llm_config.get(field)
            if str(dumped).rstrip("/") != str(value).rstrip("/"):
                continue
            llm_config[field] = previous_llm.get(field, cls._LLM_YAML_DEFAULTS[field])

        file_key = str(llm_config.get("api_key") or "").strip()
        if not file_key or file_key == "xxxx":
            llm_config["api_key"] = ""
        return data

    def load(self) -> Optional[AppConfig]:
        """从本地yaml文件中加载应用配置"""
        # 1.创建默认配置确保文件存在
        self._create_default_app_config_if_not_exists()

        try:
            # 2.打开配置文件并加载为AppConfig
            with open(self._config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                if not data:
                    return None
                return self._apply_llm_env(AppConfig.model_validate(data))
        except Exception as e:
            logger.error(f"读取应用配置失败: {str(e)}")
            raise ServerRequestsError("读取应用配置失败，请稍后尝试")

    def save(self, app_config: AppConfig) -> None:
        """将app_config存储到本地yaml配置"""
        # 1.写入之前先上锁
        lock = FileLock(self._lock_file, timeout=5)

        try:
            with lock:
                previous = None
                if self._config_path.exists():
                    with open(self._config_path, "r", encoding="utf-8") as existing:
                        previous = yaml.safe_load(existing)
                # 2.将app_config转换成json，避免把 .env 覆盖值写入已跟踪文件
                data_to_dump = self._redact_llm_env(app_config.model_dump(mode="json"), previous)

                # 3.打开yaml文件并写入
                with open(self._config_path, "w", encoding="utf-8") as f:
                    yaml.dump(data_to_dump, f, allow_unicode=True, sort_keys=False)
        except TimeoutError:
            logger.error("无法获取配置文件")
            raise ServerRequestsError("写入配置文件失败，请稍后尝试")
