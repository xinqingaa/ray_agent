"""工作区文件夹的外部变更推送：有订阅者的可用文件夹才被监视，没有订阅者即停止。

变化来自两路：文件系统通知，以及有界的定期重扫（通知可能丢失或不被文件系统支持，不是唯一依据）。每个文件夹同一时刻
只有一个监视任务，订阅者各自有有界队列，慢订阅者被合并成一次「整体刷新」而不是无限堆积。文件夹被移动或删除时
很快标记不可用并推送，回到原处后恢复。应用自己的写入同样会产生通知，这是预期的。
"""
import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional

from app.domain.external.folder_watch import FolderWatcher
from app.domain.external.workspace_files import WorkspaceFileError, WorkspaceFiles
from app.domain.external.workspace_folders import FolderAccess
from app.domain.models.clock import utc_now
from app.domain.models.identity import RootedPath
from app.domain.models.workspace import FolderStatus, RootRecord
from app.domain.models.workspace_change import WorkspaceChangeEvent
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)

_CLOSED = object()
UNAVAILABLE_REASON = "文件夹不存在、已移动或已被替换"


@dataclass
class _Topic:
    workspace_id: str
    queues: set[asyncio.Queue] = field(default_factory=set)
    task: Optional[asyncio.Task] = None
    available: Optional[bool] = None


class WorkspaceChangeFeed:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Callable[[], IUnitOfWork],
                 folders: FolderAccess, files: WorkspaceFiles, watcher: FolderWatcher, *, probe_seconds: float,
                 rescan_seconds: float, paths_per_event: int, queue_size: int = 64) -> None:
        self._uow_factory, self._read_uow_factory = uow_factory, read_uow_factory
        self._folders, self._files, self._watcher = folders, files, watcher
        self._probe, self._rescan, self._paths_per_event, self._queue_size = (
            probe_seconds, rescan_seconds, paths_per_event, queue_size)
        self._topics: dict[str, _Topic] = {}
        self._closed = False

    # ---- 订阅 ----

    async def _record(self, workspace_id: str) -> Optional[RootRecord]:
        async with self._read_uow_factory() as uow:
            return await uow.root.workspace_folder(workspace_id)

    async def _matches(self, record: RootRecord) -> Optional[bool]:
        """文件夹是否仍是登记的那个；权限、描述符耗尽等无法判断时为 None，调用方保持原状态而不是当作失联。"""
        if record.dev is None:
            return True
        try:
            return await self._folders.matches(record.location, record.dev, record.ino)
        except WorkspaceFileError as error:
            logger.warning("无法核对工作区文件夹 workspace=%s: %s", record.ref.workspace_id, error)
            return None

    async def stream(self, workspace_id: str) -> AsyncIterator[WorkspaceChangeEvent]:
        """订阅一个工作区的变更；先给出当前可用性，之后按到达顺序推送。生成器结束或被取消即退订。"""
        if self._closed:
            return
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._queue_size)
        topic = self._topics.get(workspace_id)
        if topic is None:
            topic = self._topics[workspace_id] = _Topic(workspace_id)
        topic.queues.add(queue)
        try:
            record = await self._record(workspace_id)
            ok = record is not None and await self._matches(record) is not False
            if topic.task is None:
                self._start(topic)
            yield WorkspaceChangeEvent(kind="ready", workspace_id=workspace_id, available=ok,
                                       reason=None if ok else UNAVAILABLE_REASON)
            while True:
                item = await queue.get()
                if item is _CLOSED:
                    return
                yield item
        finally:
            topic.queues.discard(queue)
            if not topic.queues:
                self._topics.pop(workspace_id, None)
                if topic.task is not None:
                    topic.task.cancel()

    async def restart(self, workspace_id: str) -> None:
        """工作区改绑到新文件夹后：停掉旧位置的监视，在新位置重建，并通知订阅者整体刷新。"""
        topic = self._topics.get(workspace_id)
        if topic is None or self._closed:
            return
        old, topic.task = topic.task, None
        if old is not None:
            old.cancel()
            await asyncio.gather(old, return_exceptions=True)
        record = await self._record(workspace_id)
        ok = record is not None and await self._matches(record) is not False
        topic.available = ok
        self._publish(topic, WorkspaceChangeEvent(kind="availability", workspace_id=workspace_id, available=ok,
                                                  reason=None if ok else UNAVAILABLE_REASON))
        self._publish(topic, WorkspaceChangeEvent(kind="changed", workspace_id=workspace_id, available=ok,
                                                  refresh=True))
        if topic.queues and not self._closed and topic.task is None:
            self._start(topic)

    def _start(self, topic: _Topic) -> None:
        topic.task = asyncio.create_task(self._run(topic), name=f"workspace-watch-{topic.workspace_id}")
        topic.task.add_done_callback(lambda task: self._finished(topic, task))

    def _finished(self, topic: _Topic, task: asyncio.Task) -> None:
        """监视任务结束：清空引用，之后的新订阅会重建；异常退出时通知现有订阅者整体刷新并重建。"""
        if topic.task is task:
            topic.task = None
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        logger.error("工作区监视任务异常退出", exc_info=error)
        if topic.queues and not self._closed:
            self._publish(topic, WorkspaceChangeEvent(kind="changed", workspace_id=topic.workspace_id,
                                                      available=bool(topic.available), refresh=True))

            def rebuild() -> None:
                if topic.task is None and topic.queues and not self._closed:
                    self._start(topic)
            asyncio.get_running_loop().call_later(self._probe, rebuild)  # 持续失败时不空转

    async def shutdown(self) -> None:
        """应用关闭：结束全部订阅并等待监视任务退出。"""
        self._closed = True
        topics = list(self._topics.values())
        for topic in topics:
            for queue in list(topic.queues):
                self._push(queue, _CLOSED)
            if topic.task is not None:
                topic.task.cancel()
        await asyncio.gather(*(topic.task for topic in topics if topic.task is not None), return_exceptions=True)
        self._topics.clear()

    # ---- 推送 ----

    @staticmethod
    def _push(queue: asyncio.Queue, item) -> None:
        if queue.full():
            while not queue.empty():
                queue.get_nowait()
            if item is not _CLOSED:
                item = WorkspaceChangeEvent(kind="changed", workspace_id=item.workspace_id, available=True,
                                            refresh=True)
        queue.put_nowait(item)

    def _publish(self, topic: _Topic, event: WorkspaceChangeEvent) -> None:
        for queue in list(topic.queues):
            self._push(queue, event)

    def _notify_index(self, workspace_id: str, paths: Optional[list[str]] = None) -> None:
        """旁路通知文档索引调度；调度器未启动时忽略（测试或启动早期）。"""
        try:
            from app.application.services.document_index_scheduler import get_document_index_scheduler
            get_document_index_scheduler().notify(workspace_id, paths)
        except RuntimeError:
            pass

    def _publish_paths(self, topic: _Topic, paths: list[str]) -> None:
        if len(paths) > self._paths_per_event:
            self._publish(topic, WorkspaceChangeEvent(kind="changed", workspace_id=topic.workspace_id,
                                                      available=True, refresh=True))
            self._notify_index(topic.workspace_id, None)
        elif paths:
            self._publish(topic, WorkspaceChangeEvent(kind="changed", workspace_id=topic.workspace_id,
                                                      available=True, paths=sorted(paths)))
            self._notify_index(topic.workspace_id, paths)

    async def _set_available(self, topic: _Topic, record: RootRecord, available: bool) -> None:
        """可用性变化时写回文件夹状态并推送；首次判断只记录，订阅时的 ready 已经告知。"""
        previous, topic.available = topic.available, available
        if previous is None or previous == available:
            return
        status = FolderStatus.AVAILABLE if available else FolderStatus.UNAVAILABLE
        try:
            async with self._uow_factory() as uow:
                await uow.root.set_folder_state(record.ref.root_id, status, utc_now())
        except Exception:
            logger.exception("保存文件夹可用性失败 workspace=%s", topic.workspace_id)
        self._publish(topic, WorkspaceChangeEvent(kind="availability", workspace_id=topic.workspace_id,
                                                  available=available, reason=None if available else UNAVAILABLE_REASON))

    # ---- 监视 ----

    async def _run(self, topic: _Topic) -> None:
        while True:
            record = await self._record(topic.workspace_id)
            if record is None:
                self._publish(topic, WorkspaceChangeEvent(kind="availability", workspace_id=topic.workspace_id,
                                                          available=False, reason="工作区没有绑定文件夹"))
                return
            matched = await self._matches(record)
            if matched:
                await self._set_available(topic, record, True)
                await self._watch(topic, record)
            elif matched is False:
                await self._set_available(topic, record, False)
            await asyncio.sleep(self._probe)

    async def _ticks(self, record: RootRecord, stop: asyncio.Event) -> AsyncIterator[set[str]]:
        """通知产出的变化批次；监视无法建立时退回定时空批次，由重扫兜底。"""
        try:
            async for paths in self._watcher.watch(record.location, stop):
                yield paths
            return
        except OSError as error:
            logger.warning("文件夹通知不可用，改为定期重扫 workspace=%s: %s", record.ref.workspace_id, error)
        while not stop.is_set():
            await asyncio.sleep(self._probe)
            yield set()

    def _relative(self, location: str, paths: set[str]) -> Optional[list[str]]:
        """绝对路径转文件夹内的相对路径；根本身变化返回 None（整体刷新）。"""
        relatives = []
        for path in paths:
            relative = os.path.relpath(path, location)
            if relative == ".":
                return None
            if not relative.startswith(".."):
                relatives.append(relative.replace(os.sep, "/"))
        return relatives

    async def _snapshot(self, record: RootRecord):
        try:
            return await self._files.snapshot(RootedPath(root_id=record.ref.root_id, relative_path=""))
        except WorkspaceFileError:
            return None

    async def _watch(self, topic: _Topic, record: RootRecord) -> None:
        """可用文件夹的监视循环；文件夹失联后返回，由外层继续探测恢复。"""
        loop = asyncio.get_running_loop()
        snapshot = await self._snapshot(record)
        next_rescan = loop.time() + self._rescan
        stop = asyncio.Event()
        ticks = self._ticks(record, stop)
        try:
            async for paths in ticks:
                if paths:
                    relatives = self._relative(record.location, paths)
                    if relatives is None:
                        self._publish(topic, WorkspaceChangeEvent(kind="changed", workspace_id=topic.workspace_id,
                                                                  available=True, refresh=True))
                    else:
                        self._publish_paths(topic, relatives)
                if await self._matches(record) is False:
                    await self._set_available(topic, record, False)
                    return
                if loop.time() >= next_rescan:
                    next_rescan = loop.time() + self._rescan
                    current = await self._snapshot(record)
                    if current is None:
                        continue
                    if snapshot is not None:
                        # 任一份快照被截断时覆盖的文件集合不同，只比较两边都覆盖到的文件，其余交给通知
                        keys = current.files.keys() & snapshot.files.keys() \
                            if current.truncated or snapshot.truncated else current.files.keys() | snapshot.files.keys()
                        changed = sorted({path for path in keys if current.files.get(path) != snapshot.files.get(path)})
                        if changed:
                            self._publish_paths(topic, changed)
                    snapshot = current
        finally:
            stop.set()
            try:
                await ticks.aclose()
            except Exception:
                logger.debug("关闭文件夹监视时出错", exc_info=True)
