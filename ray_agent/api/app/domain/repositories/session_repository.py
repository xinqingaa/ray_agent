#!/usr/bin/env python
# -*- coding: utf-8 -*-
from datetime import datetime
from typing import Protocol, List, Optional

from app.domain.models.file import File
from app.domain.models.memory import Memory
from app.domain.models.session import Session, SessionStatus


class SessionRepository(Protocol):
    """会话仓库协议定义"""

    async def save(self, session: Session) -> None:
        """存储或更新传递进来的会话"""
        ...

    async def get_all(self) -> List[Session]:
        """获取所有会话列表信息"""
        ...

    async def get_by_id(self, session_id: str) -> Optional[Session]:
        """根据传递的会话id查询会话"""
        ...

    async def delete_by_id(self, session_id: str) -> None:
        """根据传递的会话id删除会话"""
        ...

    async def update_title(self, session_id: str, title: str) -> None:
        """根据传递的会话id+标题更新会话信息"""
        ...

    async def set_title(self, session_id: str, title: str, source: str, expected_source: Optional[str] = None) -> bool:
        """按来源条件更新标题；异步结果不能覆盖手动标题。"""
        ...

    async def lock(self, session_id: str) -> Optional[Session]:
        """在写事务中读取会话；写事务按进入顺序串行，读到的状态在提交前不会被其他写入改变。"""
        ...

    async def page(self, *, offset: int = 0, limit: int = 50) -> tuple[List[Session], int]:
        """侧栏列表：不读取记忆与文件清单。"""
        ...

    async def update_model(self, session_id: str, model_id: str, reasoning: str) -> None:
        """保存会话下次新运行使用的模型 id 与思考参数。"""
        ...

    async def update_sampling(self, session_id: str, context_window: int, max_tokens: int, temperature: float) -> None:
        """记下这条对话使用的窗口、输出上限和温度。"""
        ...

    async def update_latest_message(self, session_id: str, message: str, timestamp: datetime) -> None:
        """根据传递的信息更新最新消息"""
        ...

    async def update_unread_message_count(self, session_id: str, count: int) -> None:
        """根据传递的信息更新未读消息数"""
        ...

    async def increment_unread_message_count(self, session_id: str) -> None:
        """运行完成时加一，表示有用户尚未查看的完成结果"""
        ...

    async def decrement_unread_message_count(self, session_id: str) -> None:
        """根据传递的会话id减少未读消息数"""
        ...

    async def update_status(self, session_id: str, status: SessionStatus) -> None:
        """根据传递的会话id更新会话状态"""
        ...

    async def add_file(self, session_id: str, file: File) -> None:
        """往会话中新增文件"""
        ...

    async def remove_file(self, session_id: str, file_id: str) -> None:
        """根据传递的会话id+文件id移除文件；调用方需区分文件id与文件路径"""
        ...

    async def get_file_by_path(self, session_id: str, filepath: str) -> Optional[File]:
        """查询会话中的文件信息"""
        ...

    async def save_memory(self, session_id: str, agent_name: str, memory: Memory) -> None:
        """更新or创建会话中指定Agent的记忆"""
        ...

    async def get_memory(self, session_id: str, agent_name: str) -> Memory:
        """根据传递的会话id+Agent名字获取记忆"""
        ...

    async def summary_material(self, session_id: str) -> dict:
        """会话摘要的有界材料与截止序号，供会话摘要生成使用。"""
        ...
