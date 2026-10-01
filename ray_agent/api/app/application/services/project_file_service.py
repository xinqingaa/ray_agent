"""项目文件协调：短事务持久占用，长 IO 在锁下执行，不把线程取消当作完成。"""
import asyncio
import logging
import hashlib
import uuid
from dataclasses import asdict
from app.domain.services.project_upload_rules import rules, classify, validate_paths
from app.domain.models.project_upload import ProjectUploadSelection
from app.infrastructure.external.project.file_io import ProjectFileIO
from datetime import datetime
from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.models.project_snapshot import ProjectSnapshot
from app.domain.models.event import EnvironmentEvent
from app.domain.services.project_operations import claim, owned, finish, mark_settling
from app.domain.services.project_file_coordinator import project_io_lock, run_file_io, run_async_io, state
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk

logger = logging.getLogger(__name__)


class ProjectFileService:
    def __init__(self, uow_factory, storage, sandbox_cls, *, max_bytes, retention=lambda: 5, ledger=None, disk_factory=SnapshotDisk, settings=None):
        self.factory, self.storage, self.sandbox_cls = uow_factory, storage, sandbox_cls
        self.max_bytes, self.retention, self.ledger = max_bytes, retention, ledger
        self.disk_factory = disk_factory
        self.settings = settings
        self.attachments = None

    def disk(self, project_id):
        return self.disk_factory(self.storage, project_id, max_bytes=self.max_bytes)

    async def get(self, project_id):
        async with self.factory() as uow:
            project = await uow.project.get(project_id)
        if not project:
            raise NotFoundError('项目不存在')
        self.storage.validate(project_id)
        return project

    async def snapshots(self, project_id):
        await self.get(project_id)
        async with self.factory() as uow:
            return await uow.project.snapshots(project_id)

    async def _capture(self, project_id, operation_id, source, *, run_id=None, session_id=None):
        snapshot_id = str(uuid.uuid4())
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.file_operation.phase = 'capturing'
            project.file_operation.results['capturing_snapshot_id'] = snapshot_id
            await uow.project.save(project)
        result, cancelled = await run_file_io(self.disk(project_id).capture, snapshot_id, allow_skip=source == 'run')
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.files_size = result['total_bytes']
            project.files_size_at = datetime.now()
            project.files_size_stale = False
            project.protection = {**result, 'source': source, 'run_id': run_id, 'snapshot_id': snapshot_id if result['state'] == 'ready' else None,
                'created_at': datetime.now().isoformat()}
            if result['state'] == 'ready':
                snapshot = ProjectSnapshot(id=snapshot_id, project_id=project_id, source=source,
                    run_id=run_id, session_id=session_id, total_bytes=result['total_bytes'], manifest_sha256=result['manifest_sha256'])
                await uow.project.add_snapshot(snapshot)
                project.file_operation.results['last_snapshot_id'] = snapshot_id
            project.file_operation.results.pop('capturing_snapshot_id', None)
            await uow.project.save(project)
            await uow.project.audit(project_id, 'protection', project.protection)
        return project.protection, cancelled

    async def _collect(self, project_id, operation_id, *, clear=False):
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            all_snapshots = await uow.project.snapshots(project_id)
            pinned = {value for value in (project.file_operation.target_snapshot_id, project.file_operation.before_snapshot_id) if value}
            keep, remove = [], []
            for source, count in (('run', self.retention()), ('protected', 3)):
                group = [s for s in all_snapshots if (s.source == 'run') == (source == 'run')]
                for index, snapshot in enumerate(group):
                    (keep if snapshot.id in pinned or (not clear and index < count) else remove).append(snapshot)
            # 先撤销持久清单；回收失败保留 pending，不回滚已发布快照。
            await uow.project.drop_snapshots(project_id, [s.id for s in remove])
            project.snapshot_gc_pending = True
            await uow.project.save(project)
        try:
            released, cancelled = await run_file_io(self.disk(project_id).collect, keep)
        except Exception as exc:
            logger.exception('项目[%s]快照回收待重试', project_id)
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                await uow.project.audit(project_id, 'snapshot_gc', {'error': str(exc), 'pending': True,
                    'released_bytes': getattr(exc, 'released_bytes', 0), 'operation_id': operation_id})
            return getattr(exc, 'released_bytes', 0), False
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.snapshot_gc_pending = False
            await uow.project.save(project)
            await uow.project.audit(project_id, 'snapshot_gc', {'pending': False, 'released_bytes': released,
                'operation_id': operation_id})
        return released, cancelled

    async def _stop_owned(self, project_id, operation_id):
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.file_operation.phase = 'checking_writers'
            await uow.project.save(project)
        try:
            _, cancelled = await run_async_io(self.sandbox_cls.stop_project_writers(project_id))
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                project.file_operation.phase = 'writers_stopped'
                await uow.project.save(project)
            return cancelled
        except BaseException as exc:
            async with self.factory() as uow:
                await finish(uow, project_id, operation_id, error='旧写入者核对失败：' + str(exc))
            raise

    async def prepare_run(self, project_id, session_id, run_id):
        async with project_io_lock(project_id):
            async with self.factory() as uow:
                operation = await claim(uow, project_id, 'snapshot', run_id=run_id, session_id=session_id)
            cancelled = False
            try:
                cancelled |= await self._stop_owned(project_id, operation.operation_id)
                if self.attachments:
                    await self.attachments.publish_run(project_id, run_id, lock_held=True)
                protection, was_cancelled = await self._capture(project_id, operation.operation_id, 'run', run_id=run_id, session_id=session_id)
                cancelled |= was_cancelled
                _, was_cancelled = await self._collect(project_id, operation.operation_id)
                cancelled |= was_cancelled
                async with self.factory() as uow:
                    project = await owned(uow, project_id, operation.operation_id)
                    run = await uow.run.get(run_id)
                    if run:
                        await uow.run.save_snapshot(run_id, {**(run.config_snapshot or {}), 'project_file_protection': protection})
                    await finish(uow, project_id, operation.operation_id)
                    if run and run.status.terminal:
                        project = await uow.project.get(project_id)
                        await mark_settling(uow, project, run_id, session_id)
                if self.ledger:
                    await self.ledger.append(session_id, [EnvironmentEvent(status='preparing', message=protection.get('reason') or '项目运行前文件快照已保存', project_file_protection=protection)], run_id=run_id)
                if cancelled:
                    raise asyncio.CancelledError()
                return protection
            except BaseException as exc:
                async with self.factory() as uow:
                    project = await uow.project.get(project_id, lock=True)
                    if (project and project.file_operation and project.file_operation.operation_id == operation.operation_id
                            and project.file_operation.phase != 'checking_writers'):
                        project.protection = {'state': 'failed', 'source': 'run', 'run_id': run_id, 'reason': str(exc) or '快照操作取消', 'created_at': datetime.now().isoformat()}
                        await uow.project.save(project)
                        await uow.project.audit(project_id, 'protection', project.protection)
                        await finish(uow, project_id, operation.operation_id)
                raise

    async def restore(self, project_id, snapshot_id):
        async with self.factory() as uow:
            operation = await claim(uow, project_id, 'restore', target_snapshot_id=snapshot_id)
        async with project_io_lock(project_id):
            try:
                stop_cancelled = await self._stop_owned(project_id, operation.operation_id)
                target = await self._target(project_id, snapshot_id)
                _, cancelled = await run_file_io(self.disk(project_id).load, target)
                cancelled |= stop_cancelled
                protection, was_cancelled = await self._capture(project_id, operation.operation_id, 'restore')
                cancelled |= was_cancelled
                async with self.factory() as uow:
                    project = await owned(uow, project_id, operation.operation_id)
                    project.file_operation.before_snapshot_id = protection['snapshot_id']
                    project.file_operation.phase = 'applying'
                    await uow.project.save(project)
                if cancelled:
                    raise asyncio.CancelledError()
                return await self._apply_restore(project_id, operation.operation_id, target)
            except BaseException as exc:
                await self._restore_error(project_id, operation.operation_id, exc)
                raise

    async def _target(self, project_id, snapshot_id):
        snapshots = await self.snapshots(project_id)
        target = next((s for s in snapshots if s.id == snapshot_id), None)
        if not target:
            raise NotFoundError('快照不存在或已淘汰')
        return target

    async def _restore_error(self, project_id, operation_id, exc):
        async with self.factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if not project or not project.file_operation or project.file_operation.operation_id != operation_id:
                return
            if project.file_operation.phase in ('applying', 'checking_writers'):
                await finish(uow, project_id, operation_id, error=str(exc) or '恢复被中断')
            else:
                project.file_operation.results['error'] = str(exc)
                await uow.project.save(project)
                await finish(uow, project_id, operation_id)

    async def _apply_restore(self, project_id, operation_id, target, *, previously_cancelled=False):
        size, cancelled = await run_file_io(self.disk(project_id).apply, target)
        cancelled |= previously_cancelled
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.files_size, project.files_size_at, project.files_size_stale = size, datetime.now(), False
            project.file_operation.results.update(restored_snapshot_id=target.id, total_bytes=size)
            await uow.project.save(project)
        # 固定的两个清单直到恢复校验完成都不淘汰。
        _, gc_cancelled = await self._collect(project_id, operation_id)
        cancelled |= gc_cancelled
        async with self.factory() as uow:
            await finish(uow, project_id, operation_id)
        if cancelled:
            raise asyncio.CancelledError()
        return {'restored_snapshot_id': target.id, 'total_bytes': size}

    async def repair_restore(self, project_id, operation_id, *, return_before=False):
        async with project_io_lock(project_id):
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                op = project.file_operation
                if op.kind != 'restore' or op.state != 'failed' or op.phase != 'applying':
                    raise ConflictError('当前没有可修复的失败恢复')
                snapshot_id = op.before_snapshot_id if return_before else op.target_snapshot_id
                op.state, op.error = 'running', None
                await uow.project.save(project)
            try:
                _, stop_cancelled = await run_async_io(self.sandbox_cls.stop_project_writers(project_id))
                return await self._apply_restore(project_id, operation_id, await self._target(project_id, snapshot_id), previously_cancelled=stop_cancelled)
            except BaseException as exc:
                await self._restore_error(project_id, operation_id, exc)
                raise

    async def cleanup(self, project_id):
        async with self.factory() as uow:
            project = await uow.project.get(project_id, lock=True)
            if not project or not project.archived_at:
                raise ConflictError('只允许清理已归档项目的快照')
            op = await claim(uow, project_id, 'cleanup')
        async with project_io_lock(project_id):
            try:
                stop_cancelled = await self._stop_owned(project_id, op.operation_id)
                released, cancelled = await self._collect(project_id, op.operation_id, clear=True)
                cancelled |= stop_cancelled
                async with self.factory() as uow:
                    project = await owned(uow, project_id, op.operation_id)
                    project.snapshots_cleaned_at, project.snapshots_released_bytes = datetime.now(), released
                    project.file_operation.results['released_bytes'] = released
                    await uow.project.save(project)
                    await finish(uow, project_id, op.operation_id)
                if cancelled:
                    raise asyncio.CancelledError()
                return {'released_bytes': released, 'gc_pending': project.snapshot_gc_pending}
            except BaseException:
                async with self.factory() as uow:
                    project = await uow.project.get(project_id, lock=True)
                    if (project and project.file_operation and project.file_operation.operation_id == op.operation_id
                            and project.file_operation.phase != 'checking_writers'):
                        project.snapshot_gc_pending = True
                        await uow.project.save(project)
                        await finish(uow, project_id, op.operation_id)
                raise

    async def reconcile_operation(self, project_id, operation_id, *, startup=False):
        # 运行中的线程仍有所有权，人工重试不能提前清除它的持久占用。
        if state()['writers'].get(project_id) and not startup:
            raise ConflictError('旧启动或运行器尚未退出，请等待后读回')
        async with project_io_lock(project_id):
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                op = project.file_operation.model_copy(deep=True)
                if await uow.run.get_active_project(project_id):
                    raise ConflictError('项目仍有活动运行，先回复或停止')
                if not startup and op.state != 'failed':
                    raise ConflictError('文件操作仍在处理，请先读回结果')
            try:
                _, cancelled = await run_async_io(self.sandbox_cls.stop_project_writers(project_id))
            except BaseException as exc:
                async with self.factory() as uow:
                    await finish(uow, project_id, operation_id, error='旧写入者核对失败：' + str(exc))
                raise
            if op.kind == 'restore' and op.phase == 'applying':
                async with self.factory() as uow:
                    await finish(uow, project_id, operation_id, error='恢复未完成，请重试本次恢复或回到恢复前')
                return {'state': 'failed', 'repair_required': True}
            if op.kind == 'upload' and op.results.get('selection'):
                selection = ProjectUploadSelection.model_validate(op.results['selection'])
                received = op.results.setdefault('received', {})
                for item in selection.items:
                    try:
                        digest, size = await asyncio.to_thread(self.file_io(project_id).hash_file, item.path)
                        ready_item = (digest, size) == (item.sha256, item.size)
                    except (OSError, ValueError):
                        ready_item = False
                    received[item.path] = ({'path': item.path, 'published': True, 'sha256': digest, 'size': size,
                        'reused': True} if ready_item else {'path': item.path, 'published': False, 'error': '上传中断或文件未发布'})
                async with self.factory() as uow:
                    project = await owned(uow, project_id, operation_id)
                    project.file_operation.results.update(received=received, batch_status='partial_failure')
                    await uow.project.save(project)
            async with self.factory() as uow:
                ready = await uow.project.snapshots(project_id)
            try:
                released, was_cancelled = await run_file_io(self.disk(project_id).collect, ready)
                cancelled |= was_cancelled
                gc_error = None
            except Exception as exc:
                released, gc_error = getattr(exc, 'released_bytes', 0), str(exc)
            size, was_cancelled = await run_file_io(self.file_io(project_id).size)
            cancelled |= was_cancelled
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                project.files_size, project.files_size_at, project.files_size_stale = size, datetime.now(), False
                project.snapshot_gc_pending = gc_error is not None
                project.file_operation.results.update(interrupted=True, error='API 重启或操作中断', released_bytes=released)
                await uow.project.save(project)
                await uow.project.audit(project_id, 'snapshot_gc', {'operation_id': operation_id, 'released_bytes': released, 'error': gc_error})
                await finish(uow, project_id, operation_id)
            if cancelled:
                raise asyncio.CancelledError()
            return {'state': 'completed', 'interrupted': True, 'gc_pending': gc_error is not None}

    async def reconcile_startup(self):
        async with self.factory() as uow:
            projects = await uow.project.all()
        for project in projects:
            if project.file_operation and project.file_operation.kind != 'settling':
                try:
                    await self.reconcile_operation(project.id, project.file_operation.operation_id, startup=True)
                except Exception:
                    logger.exception('项目[%s]遗留文件操作核对失败，保持占用', project.id)

    def upload_rules(self):
        if self.settings is None:
            from core.config import Settings
            return rules(Settings(_env_file=None, project_max_bytes=self.max_bytes))
        return rules(self.settings)

    def file_io(self, project_id):
        return ProjectFileIO(self.storage.files_path(project_id), uid=self.storage.uid, gid=self.storage.gid)

    def _preflight(self, project_id, selection):
        rule = self.upload_rules()
        if selection.rule_version != rule['version']:
            raise ConflictError('上传规则已变化，请重新扫描并确认')
        inventory, confirmed = validate_paths(selection)
        store = self.file_io(project_id)
        existing = {e.path: e for e in store.walk()}
        projected = current_size = sum(e.size for e in existing.values() if e.type == 'file')
        items, fingerprint, warnings, errors = [], {}, [], []
        selected_size, selected_count = 0, 0
        folded = {}
        for path in existing:
            folded.setdefault(path.casefold(), []).append(path)
        for item in selection.items:
            decision = classify(item.path, inventory, rule)
            include = decision['policy'] == 'include' or (decision['policy'] == 'optional' and decision['confirmation_path'] in confirmed)
            if item.size > rule['max_file_bytes']:
                decision = {'policy': 'always', 'reason': '文件超过单文件上限'}
                include = False
            record = {**item.model_dump(), **decision, 'included': include, 'reuse': False}
            if include:
                selected_size += item.size; selected_count += 1
                parent = item.path.rpartition('/')[0]
                while parent:
                    if parent in existing and existing[parent].type != 'directory':
                        errors.append(f'上传父路径不是目录：{parent}')
                    parent = parent.rpartition('/')[0]
                old = existing.get(item.path)
                fingerprint[item.path] = None
                if old:
                    if old.type != 'file':
                        errors.append(f'文件/目录或链接类型冲突：{item.path}')
                        fingerprint[item.path] = {'type': old.type}
                    else:
                        content_hash, actual_size = store.hash_file(item.path)
                        fingerprint[item.path] = {'type': 'file', 'sha256': content_hash, 'size': actual_size}
                        record['reuse'] = content_hash == item.sha256 and actual_size == item.size
                        record['conflict'] = not record['reuse']
                        projected += item.size - actual_size
                else:
                    projected += item.size
                cases = [path for path in folded.get(item.path.casefold(), []) if path != item.path]
                if cases:
                    warnings.append({'path': item.path, 'case_conflicts': cases})
                folded.setdefault(item.path.casefold(), []).append(item.path)
            items.append(record)
        if selected_size > rule['max_batch_bytes']:
            errors.append('待上传集合超过单次总量上限')
        if selected_count > rule['max_files']:
            errors.append('待上传集合超过文件数量上限')
        if projected > rule['max_project_bytes']:
            errors.append('上传后的项目文件超过总量上限')
        return {'rule_version': rule['version'], 'items': items, 'fingerprint': fingerprint,
            'current_bytes': current_size, 'projected_bytes': projected, 'upload_bytes': selected_size,
            'upload_count': selected_count, 'warnings': warnings, 'errors': errors,
            'empty_directories': '仅上传文件及其父目录；空目录不保留'}

    async def preflight_upload(self, project_id, selection):
        await self.get(project_id)
        result, cancelled = await run_file_io(self._preflight, project_id, selection)
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def start_upload(self, project_id, selection):
        async with self.factory() as uow:
            op = await claim(uow, project_id, 'upload')
        async with project_io_lock(project_id):
            try:
                cancelled = await self._stop_owned(project_id, op.operation_id)
                preflight, was_cancelled = await run_file_io(self._preflight, project_id, selection)
                cancelled |= was_cancelled
                if preflight['errors']:
                    raise BadRequestError('；'.join(preflight['errors']))
                if not selection.items or any(not item['included'] for item in preflight['items']):
                    raise BadRequestError('确认集合包含排除项，或没有文件；默认排除项须逐项明确确认')
                if selection.fingerprint != preflight['fingerprint']:
                    raise ConflictError('项目文件冲突已变化，请重新预检并确认')
                if any(item.get('conflict') and not item['overwrite'] for item in preflight['items']):
                    raise ConflictError('同名文件尚未确认覆盖，请重新预检')
                async with self.factory() as uow:
                    project = await owned(uow, project_id, op.operation_id)
                    project.file_operation.results.update(selection=selection.model_dump(mode='json'),
                        received={item['path']: {'path': item['path'], 'size': item['size'], 'sha256': item['sha256'],
                            'published': True, 'reused': True} for item in preflight['items'] if item['reuse']},
                        batch_status='uploading', preflight=preflight)
                    await uow.project.save(project)
                if any(item.get('conflict') for item in preflight['items']):
                    protection, was_cancelled = await self._capture(project_id, op.operation_id, 'upload')
                    cancelled |= was_cancelled
                    async with self.factory() as uow:
                        project = await owned(uow, project_id, op.operation_id)
                        project.file_operation.before_snapshot_id = protection['snapshot_id']
                        await uow.project.save(project)
                async with self.factory() as uow:
                    project = await owned(uow, project_id, op.operation_id)
                    project.file_operation.phase = 'receiving'
                    project.file_operation.last_active_at = datetime.now()
                    await uow.project.save(project)
                if cancelled:
                    # 请求结果未知，保留批次，可读回/取消，不能自动再次创建。
                    raise asyncio.CancelledError()
                return project.file_operation.model_dump(mode='json')
            except BaseException as exc:
                async with self.factory() as uow:
                    project = await uow.project.get(project_id, lock=True)
                    if (project and project.file_operation and project.file_operation.operation_id == op.operation_id
                            and project.file_operation.phase not in ('checking_writers', 'receiving')):
                        project.file_operation.results.update(batch_status='failed', error=str(exc))
                        await uow.project.save(project)
                        await finish(uow, project_id, op.operation_id)
                raise

    async def upload_item(self, project_id, operation_id, path, source):
        async with project_io_lock(project_id):
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                op = project.file_operation
                if op.kind != 'upload' or op.phase != 'receiving' or op.state != 'running':
                    raise ConflictError('上传批次不在接收阶段，请读回状态')
                selection = ProjectUploadSelection.model_validate(op.results['selection'])
                item = next((i for i in selection.items if i.path == path), None)
                if item is None:
                    raise BadRequestError('文件不在已确认清单中')
                op.last_active_at = datetime.now()
                await uow.project.save(project)
                expected = op.results['preflight']['fingerprint'][path]
            cancelled = False
            try:
                if selection.rule_version != self.upload_rules()['version']:
                    raise ConflictError('上传规则已变化，请重新预检')
                store = self.file_io(project_id)
                def publish():
                    try:
                        old_hash, old_size = store.hash_file(path)
                        if (old_hash, old_size) == (item.sha256, item.size):
                            digest, received_size = hashlib.sha256(), 0
                            while chunk := source.read(1024 * 1024):
                                received_size += len(chunk)
                                if received_size > item.size or received_size > self.upload_rules()['max_file_bytes']:
                                    raise BadRequestError('实际上传文件超过确认大小或上限')
                                digest.update(chunk)
                            if received_size != item.size or digest.hexdigest() != item.sha256:
                                raise BadRequestError('实际上传文件大小或哈希与确认清单不一致')
                            return {'path': path, 'size': old_size, 'sha256': old_hash, 'published': True, 'reused': True}
                        if expected is None or expected != {'type': 'file', 'sha256': old_hash, 'size': old_size}:
                            raise ConflictError('文件在批次中发生变化，请重新预检')
                    except FileNotFoundError:
                        old_size = 0
                        if expected is not None:
                            raise ConflictError('同名冲突已变化，请重新预检')
                    if store.size() - old_size + item.size > self.upload_rules()['max_project_bytes']:
                        raise BadRequestError('实际项目文件超过总量上限')
                    result = store.publish(path, source, overwrite=item.overwrite,
                        expected_size=item.size, expected_hash=item.sha256, max_bytes=self.upload_rules()['max_file_bytes'])
                    return {**result, 'published': True, 'reused': False}
                result, cancelled = await run_file_io(publish)
            except Exception as exc:
                result = {'path': path, 'published': False, 'error': str(exc)}
            # 文件发布后提交失败不盲删；再次请求先核对同路径/哈希，只补结果。
            async with self.factory() as uow:
                project = await owned(uow, project_id, operation_id)
                project.file_operation.results['received'][path] = result
                project.file_operation.last_active_at = datetime.now()
                project.files_size_stale = True
                await uow.project.save(project)
                await uow.project.audit(project_id, 'upload_item', {'operation_id': operation_id, **result})
            if cancelled:
                raise asyncio.CancelledError()
            return result

    async def _end_upload(self, project_id, operation_id, *, reason=None):
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            op = project.file_operation
            if op.kind != 'upload' or op.phase != 'receiving':
                raise ConflictError('批次仍在准备或核对环境，请先读回')
            selection = ProjectUploadSelection.model_validate(op.results['selection'])
            received = op.results['received']
            for item in selection.items:
                received.setdefault(item.path, {'path': item.path, 'published': False, 'error': reason or '该文件尚未上传'})
            op.results['batch_status'] = reason or ('completed' if all(item.get('published') for item in received.values()) else 'partial_failure')
            await uow.project.save(project)
        size, cancelled = await run_file_io(self.file_io(project_id).size)
        _, gc_cancelled = await self._collect(project_id, operation_id)
        cancelled |= gc_cancelled
        async with self.factory() as uow:
            project = await owned(uow, project_id, operation_id)
            project.files_size, project.files_size_at, project.files_size_stale = size, datetime.now(), False
            await uow.project.save(project)
            result = project.file_operation.model_dump(mode='json')
            await finish(uow, project_id, operation_id)
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def end_upload(self, project_id, operation_id, *, cancel=False):
        async with project_io_lock(project_id):
            return await self._end_upload(project_id, operation_id, reason='cancelled' if cancel else None)

    async def operation_result(self, project_id, operation_id):
        project = await self.get(project_id)
        if project.file_operation and project.file_operation.operation_id == operation_id:
            return project.file_operation.model_dump(mode='json')
        async with self.factory() as uow:
            result = await uow.project.operation_result(project_id, operation_id)
        if result is None:
            raise NotFoundError('文件操作记录不存在')
        return result

    async def expire_uploads(self):
        async with self.factory() as uow:
            projects = await uow.project.all()
        now = datetime.now()
        for project in projects:
            op = project.file_operation
            if op and op.kind == 'upload' and op.phase == 'receiving' and op.state == 'running':
                if (now - op.last_active_at).total_seconds() > 600 or (now - op.started_at).total_seconds() > 1800:
                    lock = project_io_lock(project.id)
                    if lock.locked():
                        continue
                    async with lock:
                        await self._end_upload(project.id, op.operation_id, reason='expired')

    async def reconcile_orphans(self):
        async with self.factory() as uow:
            projects = await uow.project.all()
        for previous in projects:
            if not (self.storage.files_path(previous.id).parent / 'snapshots').exists():
                continue
            async with self.factory() as uow:
                project = await uow.project.get(previous.id, lock=True)
                if project.file_operation or await uow.run.get_active_project(project.id):
                    continue
                op = await claim(uow, project.id, 'cleanup' if project.archived_at else 'snapshot')
            try:
                await self.reconcile_operation(project.id, op.operation_id, startup=True)
            except Exception:
                logger.exception('项目[%s]快照孤儿回收待重试', project.id)

    async def download(self, project_id, path=None):
        from app.infrastructure.external.project.download import stream_file, stream_zip
        project = await self.get(project_id)
        store = self.file_io(project_id)
        async with self.factory() as uow:
            active = await uow.run.get_active_project(project_id)
        warning = ('恢复未完成，当前文件可能是混合状态' if project.file_operation and project.file_operation.kind == 'restore'
            else '运行或文件操作中下载的内容可能不完整' if active or project.file_operation else '')
        if path is not None:
            from app.domain.services.project_paths import normalize_relative
            normalized = normalize_relative(path)
            if not normalized:
                raise BadRequestError('下载路径必须是项目内相对路径')
            # 响应头发送前确认是普通文件；流开始时再次无跟随打开。
            def check():
                with store.open_regular(normalized):
                    pass
            _, cancelled = await run_file_io(check)
            if cancelled:
                raise asyncio.CancelledError()
            return stream_file(store, normalized), normalized.rsplit('/', 1)[-1], 'application/octet-stream', warning
        entries, cancelled = await run_file_io(lambda: list(store.walk()))
        if sum(e.size for e in entries if e.type == 'file') > self.upload_rules()['max_project_bytes']:
            raise BadRequestError('项目超过整项目下载上限，请分文件下载或精简文件')
        if cancelled:
            raise asyncio.CancelledError()
        return stream_zip(store, entries, self.upload_rules()['max_project_bytes']), project.name + '.zip', 'application/zip', warning

    async def measure_size(self, project_id):
        return await run_file_io(self.file_io(project_id).size)
