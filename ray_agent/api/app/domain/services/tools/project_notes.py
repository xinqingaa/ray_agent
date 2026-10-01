"""仅项目内注册；权限与计划模式沿用统一工具管线。"""
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool


class ProjectNotesTool(BaseTool):
    name = 'project_notes'

    def __init__(self, update):
        super().__init__()
        self._update = update

    @tool(name='update_project_notes', description='整体替换项目笔记（至多8000字符）。使用当前 notes_version；冲突返回当前全文与版本，合并后重试。成功返回新的版本。',
          parameters={'content': {'type': 'string', 'description': '完整的新笔记，最多8000字符'},
                      'base_version': {'type': 'integer', 'minimum': 0, 'description': '当前笔记版本'}},
          required=['content', 'base_version'])
    async def update_project_notes(self, content: str, base_version: int):
        return await self._update(content, base_version)
