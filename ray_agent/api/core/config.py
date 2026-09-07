#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/14 10:44
@Author  : thezehui@gmail.com
@File    : config.py
"""
from functools import lru_cache
from typing import Literal, Optional

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """MoocManus后端中控配置信息，从.env或者环境变量中加载数据"""

    # 项目基础配置
    env: str = "development"
    log_level: str = "INFO"
    app_config_filepath: str = "config.yaml"

    # LLM：对应 LLM_*，有值则覆盖 config.yaml
    llm_api_key: str = ""
    llm_model_name: str = ""
    llm_base_url: str = ""
    llm_temperature: Optional[float] = None
    llm_max_tokens: Optional[int] = None

    # 数据库相关配置
    sqlalchemy_database_uri: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/manus"

    # Redis缓存配置
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: str | None = None

    # 文件存储：local 写本地磁盘，cos 使用腾讯云对象存储
    file_storage_backend: Literal["local", "cos"] = "local"
    file_storage_local_dir: str = "data/files"

    # Cos腾讯云对象存储配置（仅 file_storage_backend=cos 时必填）
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_region: str = ""
    cos_scheme: str = "https"
    cos_bucket: str = ""
    cos_domain: str = ""

    # Sandbox配置
    sandbox_address: Optional[str] = None
    sandbox_image: Optional[str] = None
    sandbox_name_prefix: Optional[str] = None
    sandbox_ttl_minutes: Optional[int] = 60
    sandbox_network: Optional[str] = None
    sandbox_chrome_args: Optional[str] = ""
    sandbox_https_proxy: Optional[str] = None
    sandbox_http_proxy: Optional[str] = None
    sandbox_no_proxy: Optional[str] = None

    # 使用pydantic v2的写法来完成环境变量信息的告知
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("file_storage_backend", mode="before")
    @classmethod
    def normalize_file_storage_backend(cls, value):
        """空值回落到本地磁盘，显式取值统一为小写。"""
        if value is None or (isinstance(value, str) and not value.strip()):
            return "local"
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator("llm_temperature", "llm_max_tokens", mode="before")
    @classmethod
    def empty_llm_number_as_none(cls, value):
        """未填写的数字项保持为空，回落到 yaml 默认值。"""
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return value

    @model_validator(mode="after")
    def validate_file_storage(self):
        """云端模式必须提供腾讯云 COS 访问配置。"""
        if self.file_storage_backend == "cos":
            missing = [
                name for name, value in (
                    ("COS_SECRET_ID", self.cos_secret_id),
                    ("COS_SECRET_KEY", self.cos_secret_key),
                    ("COS_REGION", self.cos_region),
                    ("COS_BUCKET", self.cos_bucket),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"FILE_STORAGE_BACKEND=cos 时必须配置: {', '.join(missing)}")
        return self


@lru_cache()
def get_settings() -> Settings:
    """获取当前MoocManus项目的配置信息，并对内容进行缓存，避免重复读取"""
    settings = Settings()
    return settings
