#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Any, Optional, TypeVar, Generic

from pydantic import BaseModel, PrivateAttr

T = TypeVar("T")


class ToolResult(BaseModel, Generic[T]):
    """工具结果Domain模型"""
    success: bool = True  # 是否成功调用
    message: Optional[str] = ""  # 额外的信息提示
    data: Optional[T] = None  # 工具的执行结果/数据
    # 适配层截断前的完整内容，只在进程内交给结果整形落盘，不序列化、不进入记忆与事件
    _full_content: Any = PrivateAttr(default=None)

    @property
    def full_content(self) -> Any:
        return self._full_content

    def with_full_content(self, content: Any) -> "ToolResult":
        self._full_content = content
        return self

    @classmethod
    def from_sandbox(cls, code: int, msg: str, data: Optional[T], **kwargs) -> "ToolResult":
        """将从沙箱中返回的API数据转换成工具结果"""
        return cls(
            success=True if code < 300 else False,
            message=msg,
            data=data,
        )
