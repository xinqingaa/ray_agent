#!/usr/bin/env python
# -*- coding: utf-8 -*-
from functools import lru_cache
from typing import Optional

from pydantic import Field
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

    # 图片、PDF 与网页预览按 URL 加载，用短期票据代替实例令牌
    resource_ticket_seconds: int = Field(default=600, gt=0)
    resource_ticket_capacity: int = Field(default=1024, gt=0)

    # 应用内静态项目预览与目录打包导出
    static_preview_mount_seconds: int = Field(default=1800, gt=0)
    static_preview_mount_capacity: int = Field(default=128, gt=0)
    static_preview_zip_max_files: int = Field(default=2000, gt=0)
    static_preview_zip_max_bytes: int = Field(default=256 * 1024 * 1024, gt=0)
    static_preview_html_inject_bytes: int = Field(default=16 * 1024 * 1024, gt=0)

    # 应用内轻量受管服务预览
    managed_preview_max_per_workspace: int = Field(default=2, ge=1)
    managed_preview_max_global: int = Field(default=4, ge=1)
    managed_preview_start_timeout_seconds: float = Field(default=15.0, gt=0)
    managed_preview_health_interval_seconds: float = Field(default=0.25, gt=0)
    managed_preview_stop_grace_seconds: float = Field(default=2.0, ge=0)
    managed_preview_log_tail_chars: int = Field(default=4000, gt=0)

    # 后台任务
    background_job_concurrency: int = Field(default=2, ge=1)
    background_job_poll_seconds: float = Field(default=30, gt=0)

    # 文件夹工作区与限根文件 IO
    workspace_default_location: str = "~/RayAgent"  # 新建工作区文件夹所在的默认位置；用户改动后存入应用配置
    workspace_blocked_paths: list[str] = Field(default_factory=lambda: [
        "/System", "/Library", "/usr", "/bin", "/sbin", "/private", "/etc", "/var", "/Applications",
        "/dev", "/proc", "/sys", "/boot", "/lib", "/lib64", "/run"])
    folder_grant_seconds: int = Field(default=300, gt=0)  # 宿主选择文件夹后的一次性凭证有效期
    folder_grant_capacity: int = Field(default=64, gt=0)
    marker_conflict_seconds: int = Field(default=600, gt=0)  # 复制文件夹冲突等待用户选择的期限
    file_read_bytes: int = Field(default=4 * 1024 * 1024, gt=0)
    file_list_entries: int = Field(default=2000, gt=0)
    file_scan_entries: int = Field(default=50_000, gt=0)
    file_scan_depth: int = Field(default=32, gt=0)
    file_write_bytes: int = Field(default=2 * 1024 * 1024 * 1024, gt=0)
    file_search_matches: int = Field(default=200, gt=0)
    file_find_results: int = Field(default=500, gt=0)
    file_find_entries: int = Field(default=20_000, gt=0)

    # 写前备份、撤销预览与外部变更监听
    backup_free_reserve_bytes: int = Field(default=64 * 1024 * 1024, ge=0)  # 数据卷可用空间低于它加备份大小时停止新发布
    change_preview_bytes: int = Field(default=256 * 1024, gt=0)  # 撤销预览的统一 diff 每侧最多读取的字节数
    change_preview_lines: int = Field(default=2000, gt=0)  # 统一 diff 最多输出的行数
    change_runs_default: int = Field(default=20, ge=1)  # 最近有修改的运行列表默认条数（最多 100）
    watch_debounce_ms: int = Field(default=300, gt=0)  # 文件系统通知合并窗口
    workspace_probe_seconds: float = Field(default=2.0, gt=0)  # 监听期间核对文件夹可用性的间隔
    workspace_rescan_seconds: float = Field(default=30.0, gt=0)  # 兜底重扫间隔，通知不是唯一依据
    change_paths_per_event: int = Field(default=200, gt=0)  # 一次变化事件最多列出的路径，超出改为整体刷新

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
    skill_catalog_description_chars: int = Field(default=160, gt=0)
    skill_active_chars: int = Field(default=100000, gt=0)
    skill_resource_chars: int = Field(default=8000, gt=0)
    skill_fetch_seconds: int = Field(default=90, gt=0)
    skill_preview_seconds: int = Field(default=3600, gt=0)
    skill_global_location: str = "~/RayAgent"  # 独立于新建工作区的默认父目录
    skill_discovery_max_entries: int = Field(default=5000, gt=0)
    skill_discovery_max_depth: int = Field(default=6, gt=0)
    skill_discovery_cache_entries: int = Field(default=2048, gt=0)
    skill_market_cache_seconds: int = Field(default=900, gt=0)
    skill_market_timeout_seconds: int = Field(default=12, gt=0)
    skill_market_response_bytes: int = Field(default=2 * 1024 * 1024, gt=0)
    skill_market_description_concurrency: int = Field(default=4, gt=0)
    skill_market_description_cache_entries: int = Field(default=512, gt=0)


    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)



@lru_cache()
def get_settings() -> Settings:
    return Settings()
