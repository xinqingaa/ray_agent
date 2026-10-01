"""会话交付先成功，再保存项目副本；补存按同一 run/call/path 复用附件。"""
import asyncio
import hashlib
import json
from pathlib import PurePosixPath
from datetime import datetime
from fastapi import UploadFile
from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.models.project_file_copy import ProjectFileCopy
from app.domain.services.project_file_coordinator import project_io_lock, run_file_io, run_async_io
from app.domain.services.project_operations import claim, finish
from app.domain.services.tools.deliver import DeliveredFile


class ProjectDeliveryService:
    def __init__(self, files, file_storage):
        self.files, self.file_storage, self.factory = files, file_storage, files.factory

    @staticmethod
    def key(run_id, call_id, source_path):
        if not call_id:
            raise ValueError('交付缺少调用 ID，不能保证补存幂等')
        return 'delivery:' + hashlib.sha256(json.dumps([run_id, call_id, source_path]).encode()).hexdigest()

    @staticmethod
    def _digest(source):
        digest, size = hashlib.sha256(), 0
        source.seek(0)
        while chunk := source.read(1024 * 1024):
            digest.update(chunk); size += len(chunk)
        source.seek(0)
        return digest.hexdigest(), size

    async def deliver(self, project_id, session_id, run_id, call_id, source_path, sandbox):
        key = self.key(run_id, call_id, source_path)
        async with project_io_lock(project_id):
            async with self.factory() as uow:
                project = await uow.project.get(project_id, lock=True)
                active = await uow.run.get_active_project(project_id)
                if not active or active.id != run_id:
                    raise ConflictError('运行已结束，不能发起新的交付')
                if project.file_operation:
                    raise ConflictError('项目文件操作尚未结束，不能交付')
                copy = await uow.project.file_copy(project_id, key)
                file = await uow.file.get_by_id(copy.attachment_id) if copy else None
            if not copy:
                checked = await sandbox.check_file_exists(source_path)
                info = checked.data if isinstance(checked.data, dict) else {}
                if not checked.success or not info.get('exists') or not info.get('regular_file'):
                    raise FileNotFoundError(f'沙箱中不存在普通文件 {source_path}，请先写入文件再交付')
                resolved = info.get('resolved_path')
                if not resolved or not PurePosixPath(resolved).is_absolute():
                    raise ValueError('沙箱未返回实际路径，请更新沙箱镜像后重新执行')
                relative = str(PurePosixPath(resolved).relative_to('/workspace')) if PurePosixPath(resolved).is_relative_to('/workspace') else None
                source = await sandbox.download_file(resolved)
                try:
                    (digest, size), cancelled = await run_file_io(self._digest, source)
                    file, was_cancelled = await run_async_io(self.file_storage.upload_file(UploadFile(file=source, filename=PurePosixPath(source_path).name, size=size)))
                    cancelled |= was_cancelled
                finally:
                    source.close()
                measured_size = None
                if relative:
                    measured_size, was_cancelled = await run_file_io(self.files.file_io(project_id).size)
                    cancelled |= was_cancelled
                file.filepath, file.sha256, file.size = source_path, digest, size
                copy = ProjectFileCopy(project_id=project_id, copy_key=key, kind='delivery', attachment_id=file.id,
                    session_id=session_id, run_id=run_id, source_path=source_path, resolved_path=resolved, tool_call_id=call_id,
                    path=relative, sha256=digest, size=size, state='ready' if relative else 'pending')
                async with self.factory() as uow:
                    project = await uow.project.get(project_id, lock=True)
                    if measured_size is not None:
                        project.files_size, project.files_size_at, project.files_size_stale = measured_size, datetime.now(), False
                        await uow.project.save(project)
                    old = await uow.session.get_file_by_path(session_id, source_path)
                    await uow.file.save(file)
                    if old:
                        await uow.session.remove_file(session_id, old.id)
                    await uow.session.add_file(session_id, file)
                    await uow.project.save_file_copy(copy)
                    await uow.project.audit(project_id, 'delivery_accepted', copy.model_dump(mode='json'))
                if cancelled:
                    raise asyncio.CancelledError()
            if file is None:
                raise NotFoundError('已有交付附件不可用；不会重新执行整次交付')
            if copy.state == 'ready':
                return self.delivered(file, self.result(copy))
            try:
                copy = await self._persist(copy)
                return self.delivered(file, self.result(copy))
            except Exception as exc:
                await self._record_failure(copy, exc)
                return self.delivered(file, {'state':'failed', 'copy_key':key, 'path':copy.path,
                    'error':str(exc) or type(exc).__name__, 'can_retry':True})

    @staticmethod
    def delivered(file, status):
        return DeliveredFile(file=file.model_copy(update={'project_persistence':status}), project=status)

    @staticmethod
    def result(copy):
        return {'state': 'in_workspace' if copy.resolved_path and PurePosixPath(copy.resolved_path).is_relative_to('/workspace') and copy.state == 'ready' else copy.state,
            'copy_key':copy.copy_key, 'path':copy.path, 'sha256':copy.sha256, 'can_retry':copy.state != 'ready'}

    async def _persist(self, copy):
        async with self.factory() as uow:
            await uow.project.get(copy.project_id, lock=True)
            current = await uow.project.file_copy(copy.project_id, copy.copy_key)
            if current.state == 'ready':
                return current
            file = await uow.file.get_by_id(copy.attachment_id)
            if not current.path:
                reserved = {c.path for c in await uow.project.file_copies(copy.project_id) if c.path}
                current.path, cancelled = await run_file_io(self.files.attachments._allocate,
                    copy.project_id, file.filename, reserved, folder='outputs')
                await uow.project.save_file_copy(current)
                if cancelled:
                    raise asyncio.CancelledError()
            copy = current
        store = self.files.file_io(copy.project_id)
        def readback():
            try:
                return store.hash_file(copy.path) == (copy.sha256, copy.size)
            except FileNotFoundError:
                return False
        ready, cancelled = await run_file_io(readback)
        if not ready:
            source, _ = await self.file_storage.download_file(copy.attachment_id)
            try:
                _, was_cancelled = await run_file_io(store.publish, copy.path, source, expected_hash=copy.sha256, expected_size=copy.size)
                cancelled |= was_cancelled
            finally:
                source.close()
        size, was_cancelled = await run_file_io(store.size); cancelled |= was_cancelled
        async with self.factory() as uow:
            project = await uow.project.get(copy.project_id, lock=True)
            current = await uow.project.file_copy(copy.project_id, copy.copy_key)
            if current.path != copy.path:
                raise ConflictError('交付副本关联已变化，请读回最新状态')
            current.state, current.error = 'ready', None
            await uow.project.save_file_copy(current)
            project.files_size, project.files_size_at, project.files_size_stale = size, datetime.now(), False
            await uow.project.save(project)
            await uow.project.audit(copy.project_id, 'delivery_ready', current.model_dump(mode='json'))
        if cancelled:
            raise asyncio.CancelledError()
        return current

    async def _record_failure(self, copy, exc):
        async with self.factory() as uow:
            await uow.project.get(copy.project_id, lock=True)
            current = await uow.project.file_copy(copy.project_id, copy.copy_key)
            if current and current.state != 'ready':
                current.error = str(exc)
                await uow.project.save_file_copy(current)
                await uow.project.audit(copy.project_id, 'delivery_failed', current.model_dump(mode='json'))

    async def retry(self, project_id, copy_key):
        await self.files.get(project_id)
        async with self.factory() as uow:
            copy = await uow.project.file_copy(project_id, copy_key)
            if not copy or copy.kind != 'delivery':
                raise NotFoundError('交付副本不存在')
            if copy.state == 'ready':
                return self.result(copy)
            op = await claim(uow, project_id, 'delivery')
        async with project_io_lock(project_id):
            try:
                cancelled = await self.files._stop_owned(project_id, op.operation_id)
                copy = await self._persist(copy)
                async with self.factory() as uow:
                    await finish(uow, project_id, op.operation_id)
                if cancelled:
                    raise asyncio.CancelledError()
                return self.result(copy)
            except BaseException as exc:
                if isinstance(exc, Exception):
                    await self._record_failure(copy, exc)
                async with self.factory() as uow:
                    project = await uow.project.get(project_id, lock=True)
                    if project.file_operation and project.file_operation.operation_id == op.operation_id and project.file_operation.phase != 'checking_writers':
                        await finish(uow, project_id, op.operation_id)
                raise
