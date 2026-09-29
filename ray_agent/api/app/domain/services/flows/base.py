#!/usr/bin/env python
# -*- coding: utf-8 -*-
from abc import ABC, abstractmethod
from typing import AsyncGenerator

from app.domain.models.event import BaseEvent
from app.domain.models.message import Message


class BaseFlow(ABC):
    """基础流抽象类"""

    @abstractmethod
    async def invoke(self, message: Message, *args, **kwargs) -> AsyncGenerator[BaseEvent, None]:
        """流调用函数，返回可迭代的基础事件"""
        ...

    @property
    @abstractmethod
    def done(self) -> bool:
        """只读属性，用于返回流是否结束"""
        ...
