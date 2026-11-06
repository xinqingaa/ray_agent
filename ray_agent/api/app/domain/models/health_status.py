#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthStatus(BaseModel):
    """健康检查状态"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    service: str = Field(default="", description="健康检查对应的服务名字")
    status: Literal["ok", "error"] = Field(default="ok", description="ok 表示正常，error 表示出错")
    details: str = Field(default="", description="出错时的详情提示")
