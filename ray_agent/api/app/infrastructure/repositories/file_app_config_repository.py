#!/usr/bin/env python
# -*- coding: utf-8 -*-
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

    @staticmethod
    def _env_api_key() -> str:
        """只从环境变量取密钥；占位符视为未配置。"""
        api_key = get_settings().llm_api_key.strip()
        if not api_key or api_key == "xxxx":
            return ""
        return api_key

    @classmethod
    def _apply_llm_env(cls, app_config: AppConfig) -> AppConfig:
        """内存中的密钥只来自 LLM_API_KEY，忽略 yaml 里的 api_key。"""
        app_config.llm_config.api_key = cls._env_api_key()
        return app_config

    @staticmethod
    def _strip_api_key(data: dict) -> dict:
        """yaml 不保存密钥。"""
        llm_config = data.get("llm_config")
        if isinstance(llm_config, dict):
            llm_config.pop("api_key", None)
        return data

    @staticmethod
    def _migrate_default_budget(data: dict) -> bool:
        """只迁移一次旧默认；会话/运行在数据库中，不在这里修改。"""
        if data.get("model_budget_defaults_version", 0) >= 1:
            return False
        from app.domain.models.model_catalog import provider_for
        llm = data.get("llm_config") or {}
        if provider_for(str(llm.get("base_url", ""))) == "deepseek":
            if llm.get("context_window") == 131072:
                llm["context_window"] = 200000
            for name in ("deepseek-flash", "deepseek-v4-pro"):
                profile = (llm.get("model_profiles") or {}).get(name)
                if profile and profile.get("context_window") == 131072:
                    profile["context_window"] = 200000
        data["model_budget_defaults_version"] = 1
        return True

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
                changed = self._migrate_default_budget(data)
                config = self._apply_llm_env(AppConfig.model_validate(self._strip_api_key(data)))
                if changed:
                    self.save(config)
                return config
        except Exception as e:
            logger.error(f"读取应用配置失败: {str(e)}")
            raise ServerRequestsError("读取应用配置失败，请稍后尝试")

    def save(self, app_config: AppConfig) -> None:
        """将app_config存储到本地yaml配置"""
        # 1.写入之前先上锁
        lock = FileLock(self._lock_file, timeout=5)

        try:
            with lock:
                data_to_dump = self._strip_api_key(app_config.model_dump(mode="json"))
                with open(self._config_path, "w", encoding="utf-8") as f:
                    yaml.dump(data_to_dump, f, allow_unicode=True, sort_keys=False)
        except TimeoutError:
            logger.error("无法获取配置文件")
            raise ServerRequestsError("写入配置文件失败，请稍后尝试")
