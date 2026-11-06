#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import TypeVar, Generic, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.error import ErrorInfo

T = TypeVar("T")


class Response(BaseModel, Generic[T]):
    """成功响应：业务数据在 data，HTTP 状态为 2xx。失败响应见 ErrorResponse。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    data: Optional[T] = Field(default_factory=dict)  # 没有数据时为空字典

    @staticmethod
    def success(data: Optional[T] = None) -> "Response[T]":
        return Response(data=data if data is not None else {})


class ErrorResponse(BaseModel):
    """失败响应：HTTP 状态表达类别，error 给出机器可读代码、原因与重试建议。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    error: ErrorInfo
