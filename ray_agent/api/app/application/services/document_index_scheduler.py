"""文档索引调度：启动全量同步、定期重扫，并接受外部变更钩子。

不依赖文件夹面板是否有订阅者；与 WorkspaceChangeFeed 并行，通知丢失时靠重扫兜底。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from app.application.services.document_index_service import DocumentIndexService
from app.domain.models.workspace import WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)


class DocumentIndexScheduler:
    def __init__(
            self, service: DocumentIndexService, uow_factory: Callable[[], IUnitOfWork],
            read_uow_factory: Callable[[], IUnitOfWork], *, rescan_seconds: float = 30.0,
    ) -> None:
        self._service = service
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._rescan_seconds = rescan_seconds
        self._task: Optional[asyncio.Task] = None
        self._pending: dict[str, set[str] | None] = {}
        self._wake = asyncio.Event()
        self._closed = False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._closed = True
        self._wake.set()
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def notify(self, workspace_id: str, paths: Optional[list[str]] = None) -> None:
        """外部变更或添加文件后触发增量同步；paths 为空表示整区重扫。"""
        if self._closed:
            return
        if workspace_id not in self._pending or paths is None or self._pending[workspace_id] is None:
            self._pending[workspace_id] = None if paths is None else set(paths)
        elif paths is not None and self._pending[workspace_id] is not None:
            self._pending[workspace_id].update(paths)
        self._wake.set()

    async def sync_all(self) -> None:
        async with self._read_uow_factory() as uow:
            workspaces = await uow.workspace.list()
        for workspace in workspaces:
            if workspace.status is not WorkspaceStatus.ACTIVE:
                continue
            try:
                await self._service.sync_workspace(workspace.id)
            except Exception:
                logger.exception("工作区文档同步失败 workspace=%s", workspace.id)

    async def _loop(self) -> None:
        # 启动后先全量同步一次，核对暂存与哈希
        try:
            await self.sync_all()
        except Exception:
            logger.exception("启动时文档索引同步失败")
        while not self._closed:
            self._wake.clear()
            # 处理积压的变更通知
            pending, self._pending = self._pending, {}
            for workspace_id, paths in pending.items():
                try:
                    await self._service.sync_workspace(
                        workspace_id, paths=None if paths is None else paths)
                except Exception:
                    logger.exception("增量文档同步失败 workspace=%s", workspace_id)
            try:
                await asyncio.wait_for(self._wake.wait(), self._rescan_seconds)
            except asyncio.TimeoutError:
                try:
                    await self.sync_all()
                except Exception:
                    logger.exception("定期文档索引重扫失败")


_scheduler: Optional[DocumentIndexScheduler] = None


def set_document_index_scheduler(scheduler: Optional[DocumentIndexScheduler]) -> None:
    global _scheduler
    _scheduler = scheduler


def get_document_index_scheduler() -> DocumentIndexScheduler:
    if _scheduler is None:
        raise RuntimeError("文档索引调度器未启动")
    return _scheduler
