#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/17 14:56
@Author  : thezehui@gmail.com
@File    : memory.py
"""
import logging
from typing import List, Dict, Any, Optional, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class Memory(BaseModel):
    """发给模型的对话记忆：只追加，压缩时整体替换；会话事件里的原始记录不受影响。"""
    messages: List[Dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def get_message_role(cls, message: Dict[str, Any]) -> str:
        """根据传递的消息来获取消息的角色信息"""
        return message.get("role")

    def add_message(self, message: Dict[str, Any]) -> None:
        """往记忆中添加一条消息"""
        self.messages.append(message)

    def add_messages(self, messages: List[Dict[str, Any]]) -> None:
        """往记忆中添加多条消息"""
        self.messages.extend(messages)

    def get_messages(self) -> List[Dict[str, Any]]:
        """获取记忆中的所有消息列表"""
        return self.messages

    def get_last_message(self) -> Optional[Dict[str, Any]]:
        """获取记忆中的最后一条消息，如果不存在则返回None"""
        return self.messages[-1] if len(self.messages) > 0 else None

    def roll_back(self) -> None:
        """回滚记忆，删除最后一条消息"""
        self.messages = self.messages[:-1]

    def strip_reasoning(self) -> None:
        """删除此前各条消息的推理字段；新用户消息到达时调用，回复提问属于同一轮，不调用。"""
        for message in self.messages:
            if "reasoning_content" in message:
                logger.debug(f"从记忆中移除工具思考结果: {message['reasoning_content'][:50]}...")
                del message["reasoning_content"]

    def rounds(self) -> List[Tuple[int, int]]:
        """按轮切分：一轮是一条助手消息及其后紧跟的全部 tool 结果，返回每轮的 [start, end) 下标。

        轮之间的 user 消息不属于任何一轮；轮的结束位置就是可以安全切开记忆、不拆开调用与结果的边界。
        """
        spans: List[Tuple[int, int]] = []
        index = 0
        while index < len(self.messages):
            if self.messages[index].get("role") != "assistant":
                index += 1
                continue
            end = index + 1
            while end < len(self.messages) and self.messages[end].get("role") == "tool":
                end += 1
            spans.append((index, end))
            index = end
        return spans

    def replace(self, messages: List[Dict[str, Any]]) -> None:
        """整体替换记忆（压缩），第一条 system 消息保留。"""
        head = self.messages[:1] if self.messages and self.messages[0].get("role") == "system" else []
        self.messages = [*head, *messages]

    @property
    def empty(self) -> bool:
        """只读属性，检查记忆是否为空"""
        return len(self.messages) == 0
