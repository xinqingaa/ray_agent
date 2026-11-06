#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Protocol

from app.domain.models.app_config import AppConfig


class AppConfigRepository(Protocol):
    """应用配置仓库：模型、Agent、工具策略、MCP 与 A2A 配置保存在业务库，模型密钥不入库。"""

    async def load(self) -> AppConfig:
        """读取当前配置；尚未保存过的分区使用默认值"""
        ...

    async def save(self, app_config: AppConfig) -> None:
        """整体保存配置"""
        ...
