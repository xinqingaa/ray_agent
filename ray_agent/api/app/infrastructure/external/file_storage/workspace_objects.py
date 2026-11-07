"""工作区归属的内容对象：位置由工作区身份与内容哈希决定，同一工作区内相同内容只落一份字节。

字节先写临时文件并计算摘要，改名发布后再由短事务登记；登记失败只留下可辨认的孤立对象。磁盘空间不足（实际写入
失败，或可用空间低于预留）时报告不可用，调用方不发布写入；任何已登记对象都不会为腾空间而删除。
"""
import asyncio
import errno
import hashlib
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO, Callable

from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.file_change import WorkspaceObject
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_io import run_file_io

logger = logging.getLogger(__name__)

_CHUNK = 1024 * 1024
OBJECT_DIRECTORY = "w"  # 与会话附件的内容对象分开存放


def _insufficient() -> WorkspaceFileError:
    return WorkspaceFileError(ErrorCode.UNAVAILABLE, "磁盘空间不足，已停止发布新版本；未删除任何已保存的版本")


class LocalWorkspaceObjects:

    def __init__(self, objects_dir: Path, tmp_dir: Path, uow_factory: Callable[[], IUnitOfWork],
                 free_reserve_bytes: int = 0) -> None:
        self._root = Path(objects_dir)
        self._tmp = Path(tmp_dir)
        self._uow_factory = uow_factory
        self._reserve = free_reserve_bytes

    def object_path(self, key: str) -> Path:
        root = self._root.resolve()
        path = (root / key).resolve()
        if not path.is_relative_to(root / OBJECT_DIRECTORY) or path == root:
            raise ValueError(f"非法的内容对象位置: {key}")
        return path

    def _stage(self, source: BinaryIO) -> tuple[Path, int, str]:
        self._tmp.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self._tmp).free < self._reserve:
            raise _insufficient()
        partial = self._tmp / f"{uuid.uuid4().hex}.part"
        digest, size = hashlib.sha256(), 0
        try:
            with partial.open("wb") as output:
                while chunk := source.read(_CHUNK):
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                output.flush()
                os.fsync(output.fileno())
        except OSError as error:
            partial.unlink(missing_ok=True)
            if error.errno in (errno.ENOSPC, errno.EDQUOT):
                raise _insufficient()
            raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR, f"保存写前备份失败：{error.strerror or error}")
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        return partial, size, digest.hexdigest()

    def _publish(self, partial: Path, key: str) -> None:
        target = self.object_path(key)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(partial, target)
        except OSError as error:
            if error.errno in (errno.ENOSPC, errno.EDQUOT):
                raise _insufficient()
            raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR, f"保存写前备份失败：{error.strerror or error}")
        finally:
            partial.unlink(missing_ok=True)

    async def put(self, workspace_id: str, source: BinaryIO) -> WorkspaceObject:
        partial, size, sha256 = await self._run(self._stage, source)
        key = f"{OBJECT_DIRECTORY}/{workspace_id}/{sha256[:2]}/{sha256}"
        try:
            await self._run(self._publish, partial, key)
            async with self._uow_factory() as uow:
                existing = await uow.change.object_by_hash(workspace_id, sha256)
                if existing is not None:
                    return existing
                obj = WorkspaceObject(id=uuid.uuid4().hex, workspace_id=workspace_id, sha256=sha256, size=size,
                                      key=key)
                await uow.change.add_object(obj)
                return obj
        finally:
            partial.unlink(missing_ok=True)

    @staticmethod
    async def _run(function, *args):
        result, cancelled = await run_file_io(function, *args)
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def open(self, obj: WorkspaceObject) -> BinaryIO:
        path = self.object_path(obj.key)

        def opener() -> BinaryIO:
            try:
                return path.open("rb")
            except FileNotFoundError:
                raise WorkspaceFileError(ErrorCode.NOT_FOUND, "写前备份的内容对象已不存在")
        return await self._run(opener)

    async def read(self, obj: WorkspaceObject, offset: int = 0, length: int | None = None) -> bytes:
        reader = await self.open(obj)

        def load() -> bytes:
            with reader:
                reader.seek(offset)
                return reader.read() if length is None else reader.read(length)
        return await self._run(load)
