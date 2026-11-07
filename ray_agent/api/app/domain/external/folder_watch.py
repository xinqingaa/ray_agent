"""文件夹变更监视端口：只产出变化的路径，排除规则与应用自己的临时文件由实现过滤。"""
import asyncio
from typing import AsyncIterator, Protocol


class FolderWatcher(Protocol):

    def watch(self, location: str, stop: asyncio.Event) -> AsyncIterator[set[str]]:
        """逐批产出变化的绝对路径；一段时间没有事件时产出空集合，供调用方核对文件夹是否还在原处。
        stop 置位后结束；位置不存在或监视无法建立时抛出 OSError。"""
        ...
