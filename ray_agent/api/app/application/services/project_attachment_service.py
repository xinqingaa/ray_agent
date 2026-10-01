"""已上传对象→受理关联→后台发布；HTTP 受理不等待磁盘或 Docker。"""
import asyncio
from pathlib import PurePosixPath
from datetime import datetime
from app.application.errors.exceptions import BadRequestError, ConflictError
from app.domain.models.project_file_copy import ProjectFileCopy
from app.domain.services.project_upload_rules import classify
from app.domain.services.project_file_coordinator import project_io_lock, run_file_io
from app.domain.models.run import RunStatus
from app.domain.services.project_operations import claim, finish


class ProjectAttachmentService:
    def __init__(self, files, file_storage):
        self.files, self.file_storage = files, file_storage
        self.factory = files.factory

    async def stage(self, uow, project_id, session_id, run_id, event):
        if not event.attachments:
            return
        rule = self.files.upload_rules()
        if len(event.attachments) > rule['max_files'] or sum(f.size for f in event.attachments) > rule['max_batch_bytes']:
            raise BadRequestError('本条消息附件超过上传数量或总量上限')
        for file in event.attachments:
            existing = await uow.project.file_copy(project_id, 'attachment:' + file.id)
            if existing:
                if existing.state == 'pending' and existing.run_id != run_id:
                    existing.run_id, existing.session_id, existing.message_seq = run_id, session_id, event.seq
                    await uow.project.save_file_copy(existing)
                continue
            confirmation = file.project_upload or {}
            if (confirmation.get('project_id') != project_id or confirmation.get('rule_version') != rule['version']
                    or not file.sha256 or file.size > rule['max_file_bytes']):
                raise BadRequestError('项目附件未按当前规则确认，请重新预检上传')
            await uow.project.save_file_copy(ProjectFileCopy(project_id=project_id, copy_key='attachment:' + file.id,
                attachment_id=file.id, session_id=session_id, run_id=run_id, message_seq=event.seq,
                sha256=file.sha256, size=file.size))
            await uow.project.audit(project_id, 'attachment_pending', {'attachment_id': file.id,
                'session_id': session_id, 'run_id': run_id, 'message_seq': event.seq})

    def _allocate(self, project_id, filename, reserved):
        from app.domain.services.project_paths import normalize_relative
        name = normalize_relative(filename)
        if not name or '/' in name:
            raise ValueError('附件名称必须是单一文件名')
        store = self.files.file_io(project_id)
        stem, suffix = PurePosixPath(name).stem, PurePosixPath(name).suffix
        for index in range(10000):
            candidate = 'uploads/' + (name if index == 0 else f'{stem} ({index}){suffix}')
            if candidate in reserved:
                continue
            try:
                store.inspect(candidate)
            except FileNotFoundError:
                return candidate
        raise ValueError('同名附件过多，无法分配文件名')

    async def publish(self, project_id, attachment_id, run_id, *, lock_held=False):
        if not lock_held:
            async with project_io_lock(project_id):
                return await self.publish(project_id, attachment_id, run_id, lock_held=True)
        async with self.factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            run = await uow.run.get(run_id)
            if not run or run.status not in (RunStatus.RUNNING, RunStatus.WAITING):
                raise ConflictError('运行已结束，附件保持受理记录，不能继续落盘')
            op = project.file_operation
            if op and not (op.kind == 'snapshot' and op.run_id == run_id):
                raise ConflictError('项目文件操作尚未结束，附件等待核对')
            copy = await uow.project.file_copy(project_id, 'attachment:' + attachment_id)
            if not copy:
                raise BadRequestError('项目附件缺少受理关联')
            if copy.state == 'ready':
                return copy
            file = await uow.file.get_by_id(attachment_id)
            if not copy.path:
                reserved = {c.path for c in await uow.project.file_copies(project_id) if c.path}
                copy.path, cancelled = await run_file_io(self._allocate, project_id, file.filename, reserved)
                await uow.project.save_file_copy(copy)
                if cancelled:
                    raise asyncio.CancelledError()
        store = self.files.file_io(project_id)
        source = None
        try:
            # 结果未知的上次发布先核对；匹配时只补 ready，不再复制。
            def readback():
                try:
                    return store.hash_file(copy.path) == (copy.sha256, copy.size)
                except FileNotFoundError:
                    return False
            ready, cancelled = await run_file_io(readback)
            if not ready:
                source, _ = await self.file_storage.download_file(attachment_id)
                def write():
                    if store.size() + copy.size > self.files.upload_rules()['max_project_bytes']:
                        raise ValueError('附件落盘后项目超过总量上限')
                    return store.publish(copy.path, source, expected_hash=copy.sha256, expected_size=copy.size,
                        max_bytes=self.files.upload_rules()['max_file_bytes'])
                _, was_cancelled = await run_file_io(write)
                cancelled |= was_cancelled
            size, was_cancelled = await run_file_io(store.size)
            cancelled |= was_cancelled
            async with self.factory() as uow:
                project = await uow.project.get(project_id, lock=True)
                current = await uow.project.file_copy(project_id, copy.copy_key)
                if current.path != copy.path:
                    raise ConflictError('附件关联已变化，请核对结果')
                current.state, current.error = 'ready', None
                await uow.project.save_file_copy(current)
                project.files_size, project.files_size_at, project.files_size_stale = size, datetime.now(), False
                await uow.project.save(project)
                await uow.project.audit(project_id, 'attachment_ready', current.model_dump(mode='json'))
            if cancelled:
                raise asyncio.CancelledError()
            return current
        except Exception as exc:
            from sqlalchemy.exc import IntegrityError
            removed = False
            if isinstance(exc, IntegrityError):
                # 约束拒绝明确回滚；先读回关联，确认仍未 ready 后仅清理本次新副本。
                async with self.factory() as uow:
                    current = await uow.project.file_copy(project_id, copy.copy_key)
                if current and current.state == 'pending' and current.path == copy.path:
                    def remove_rejected():
                        try:
                            if store.hash_file(copy.path) == (copy.sha256, copy.size):
                                store.remove(copy.path)
                                return True
                        except FileNotFoundError:
                            pass
                        return False
                    removed, _ = await run_file_io(remove_rejected)
            # 其他提交错误可能结果未知，保留已分配路径，下一次先核对实际哈希。

            async with self.factory() as uow:
                await uow.project.get(project_id, lock=True)
                current = await uow.project.file_copy(project_id, copy.copy_key)
                if current and current.state == 'pending':
                    current.error = str(exc)
                    if removed:
                        current.path = None
                    await uow.project.save_file_copy(current)
                    await uow.project.audit(project_id, 'attachment_failed', current.model_dump(mode='json'))
            raise
        finally:
            if source is not None:
                source.close()

    async def publish_run(self, project_id, run_id, *, lock_held=False):
        async with self.factory() as uow:
            copies = await uow.project.file_copies(project_id, run_id=run_id)
        for copy in copies:
            if copy.kind == 'attachment':
                await self.publish(project_id, copy.attachment_id, run_id, lock_held=lock_held)


    async def reconcile_startup(self):
        import logging
        logger = logging.getLogger(__name__)
        async with self.factory() as uow:
            projects = await uow.project.all()
        for project in projects:
            async with self.factory() as uow:
                copies = await uow.project.file_copies(project.id)
            for copy in copies:
                if copy.kind != 'attachment' or copy.state == 'ready':
                    continue
                try:
                    async with self.factory() as uow:
                        events = await uow.event.list(copy.session_id, types=['message'])
                    linked = any(e.seq == copy.message_seq and any(f.id == copy.attachment_id for f in e.attachments) for e in events)
                    if linked:
                        matches, cancelled = False, False
                        if copy.path:
                            def inspect_published():
                                try:
                                    return self.files.file_io(project.id).hash_file(copy.path) == (copy.sha256, copy.size)
                                except (OSError, ValueError):
                                    return False
                            matches, cancelled = await run_file_io(inspect_published)
                        async with self.factory() as uow:
                            await uow.project.get(project.id, lock=True)
                            current = await uow.project.file_copy(project.id, copy.copy_key)
                            if current.state == 'pending':
                                if matches and current.path == copy.path:
                                    current.state, current.error = 'ready', None
                                    await uow.project.audit(project.id, 'attachment_ready', {**current.model_dump(mode='json'), 'startup_readback': True})
                                else:
                                    current.error = '上次环境准备中断；已受理附件保留，重新发送时可复用已上传 id'
                                await uow.project.save_file_copy(current)
                        if cancelled:
                            raise asyncio.CancelledError()
                        continue
                    async with self.factory() as uow:
                        current = await uow.project.get(project.id, lock=True)
                        if current.file_operation or await uow.run.get_active_project(project.id):
                            continue
                        op = await claim(uow, project.id, 'cleanup' if current.archived_at else 'snapshot')
                    async with project_io_lock(project.id):
                        await self.files._stop_owned(project.id, op.operation_id)
                        removed = False
                        if copy.path:
                            def remove_unconfirmed():
                                store = self.files.file_io(project.id)
                                try:
                                    if store.hash_file(copy.path) == (copy.sha256, copy.size):
                                        store.remove(copy.path)
                                        return True
                                except FileNotFoundError:
                                    pass
                                return False
                            removed, cancelled = await run_file_io(remove_unconfirmed)
                        else:
                            cancelled = False
                        async with self.factory() as uow:
                            await uow.project.get(project.id, lock=True)
                            await uow.project.drop_file_copy(project.id, copy.copy_key)
                            await uow.project.audit(project.id, 'attachment_orphan', {'copy_key': copy.copy_key,
                                'path': copy.path, 'removed': removed, 'reason': '没有已受理消息关联；既有 ready 副本不在清理范围'})
                            await finish(uow, project.id, op.operation_id)
                        if cancelled:
                            raise asyncio.CancelledError()
                except Exception:
                    logger.exception('项目[%s]附件启动核对失败，保留记录供重试', project.id)
