#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""交付工具：把沙箱中的文件交给用户。存储与会话关联由运行器注入的交付函数完成。"""
from typing import Awaitable, Callable, List, Optional

from pydantic import BaseModel, Field

from app.domain.models.file import File
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool

DELIVER_FILES_TOOL = "deliver_files"

# 交付单个沙箱路径：成功返回已关联会话的文件记录，失败抛出异常，异常文本作为错误原因回填模型
DeliverFileFn = Callable[[str], Awaitable[File]]


class DeliveryItem(BaseModel):
    """单个路径的交付结果：success 为 True 时 file 有值，否则 error 说明原因。"""
    path: str
    success: bool
    file: Optional[File] = None
    error: Optional[str] = None


class DeliveryResult(BaseModel):
    """deliver_files 的结果数据，items 与请求的 paths 一一对应、顺序相同。"""
    items: List[DeliveryItem] = Field(default_factory=list)
    note: Optional[str] = None

    @property
    def files(self) -> List[File]:
        return [item.file for item in self.items if item.success and item.file is not None]


class DeliverTool(BaseTool):
    name: str = "deliver"

    def __init__(self, deliver_file: DeliverFileFn) -> None:
        super().__init__()
        self._deliver_file = deliver_file

    @tool(
        name=DELIVER_FILES_TOOL,
        description=(
            "把沙箱中已经写好的文件作为附件交付给用户下载。需要文件成果时必须调用本工具；"
            "只在回复里写出路径不算交付。路径必须是已写入文件的绝对路径。"
        ),
        parameters={
            "paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": "要交付的文件绝对路径列表",
            },
            "note": {
                "type": "string",
                "description": "(可选)随附件展示给用户的一句说明",
            },
        },
        required=["paths"],
    )
    async def deliver_files(self, paths: List[str], note: Optional[str] = None) -> ToolResult[DeliveryResult]:
        if not paths:
            return ToolResult(success=False, message="paths 不能为空", data=DeliveryResult(note=note))

        items: List[DeliveryItem] = []
        for path in paths:
            if not isinstance(path, str) or not path.startswith("/"):
                items.append(DeliveryItem(path=str(path), success=False, error="路径必须是沙箱中的绝对路径"))
                continue
            try:
                file = await self._deliver_file(path)
            except Exception as e:
                items.append(DeliveryItem(path=path, success=False, error=str(e) or type(e).__name__))
                continue
            items.append(DeliveryItem(path=path, success=True, file=file))

        result = DeliveryResult(items=items, note=note)
        delivered = len(result.files)
        failed = [f"{item.path}（{item.error}）" for item in items if not item.success]
        message = f"已交付 {delivered}/{len(items)} 个文件"
        if failed:
            message += "；失败：" + "；".join(failed)
        return ToolResult(success=delivered > 0, message=message, data=result)
