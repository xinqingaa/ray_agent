#!/usr/bin/env python
# -*- coding: utf-8 -*-
from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """核心的系统配置，只从进程环境读取；环境文件由启动参数显式叠加，不按当前目录查找。"""

    # 项目基础配置
    env: str = "development"
    log_level: str = "INFO"
    sqlalchemy_echo: bool = False  # 对应 SQLALCHEMY_ECHO，默认关闭 SQL 回显

    # 数据根：业务库、内容对象、会话工作目录与 skill 存储都在其中，由启动参数传入
    data_root: Optional[str] = Field(default=None, validation_alias="RAYAGENT_DATA_ROOT")

    # 业务库：写协调器独占一条写连接，读取走连接池
    sqlite_busy_timeout_ms: int = Field(default=5000, gt=0)
    sqlite_begin_attempts: int = Field(default=3, ge=1)
    sqlite_read_pool_size: int = Field(default=4, ge=1)

    # 后台任务
    background_job_concurrency: int = Field(default=2, ge=1)
    background_job_poll_seconds: float = Field(default=30, gt=0)

    # skill 存储在数据根的 skills 目录
    skill_download_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    skill_package_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    skill_file_bytes: int = Field(default=5 * 1024 * 1024, gt=0)
    skill_max_files: int = Field(default=2000, gt=0)
    skill_max_candidates: int = Field(default=100, gt=0)
    skill_name_chars: int = Field(default=64, gt=0, le=64)
    skill_description_chars: int = Field(default=1024, gt=0)
    skill_body_chars: int = Field(default=60000, gt=0)
    skill_catalog_chars: int = Field(default=24000, gt=0)
    skill_active_chars: int = Field(default=100000, gt=0)
    skill_resource_chars: int = Field(default=8000, gt=0)
    skill_fetch_seconds: int = Field(default=90, gt=0)
    skill_preview_seconds: int = Field(default=3600, gt=0)

    # Docker 沙箱适配保留到本机执行端口接入，核心不再装配它
    sandbox_address: Optional[str] = None
    sandbox_image: Optional[str] = None
    sandbox_name_prefix: Optional[str] = None
    sandbox_ttl_minutes: Optional[int] = 60
    sandbox_network: Optional[str] = None
    sandbox_chrome_args: Optional[str] = ""
    sandbox_https_proxy: Optional[str] = None
    sandbox_http_proxy: Optional[str] = None
    sandbox_no_proxy: Optional[str] = None
    sandbox_memory_mb: int = 2048
    sandbox_cpus: float = 2
    sandbox_pids_limit: int = 512

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("sandbox_memory_mb", "sandbox_pids_limit")
    @classmethod
    def positive_sandbox_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("沙箱资源上限必须为正整数")
        return value

    @field_validator("sandbox_cpus")
    @classmethod
    def positive_sandbox_cpus(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("沙箱 CPU 上限必须为正数")
        return value


@lru_cache()
def get_settings() -> Settings:
    return Settings()
