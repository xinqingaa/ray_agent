"""清理持久清单与删除事务；HTTP 准入和受理共用数据库 advisory 锁。"""
import uuid
import re
from contextlib import asynccontextmanager
from datetime import datetime
from sqlalchemy import select, delete, text
from app.application.errors.exceptions import ConflictError, NotFoundError, BadRequestError
from app.domain.models.data_cleanup import CleanupPreview
from app.infrastructure.models import SessionModel, FileModel, RunModel, EventModel
from app.infrastructure.models.project import ProjectModel, ProjectAuditModel, ProjectSnapshotModel, ProjectFileCopyModel
from app.infrastructure.models.data_cleanup import DataCleanupModel

ADMISSION_LOCK = 726194310
WORKER_LOCK = 726194311


def referenced_strings(value):
    """保守保留其他对话仍引用的附件（包括历史事件与模型记忆）。"""
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return set().union(*(referenced_strings(item) for item in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(referenced_strings(item) for item in value)) if value else set()
    return set()


class DBDataCleanupRepository:
    def __init__(self, session_factory):
        self.factory = session_factory

    async def pending(self, db):
        return await db.scalar(select(DataCleanupModel).where(DataCleanupModel.state != 'completed'))

    @asynccontextmanager
    async def worker(self):
        async with self.factory() as db, db.begin():
            yield bool(await db.scalar(text('SELECT pg_try_advisory_xact_lock(:key)'), {'key': WORKER_LOCK}))

    @asynccontextmanager
    async def admission(self, path, project_id=None):
        async with self.factory() as db, db.begin():
            await db.execute(text('SELECT pg_advisory_xact_lock_shared(:key)'), {'key': ADMISSION_LOCK})
            pending = await self.pending(db)
            if pending:
                affected = pending.scope == 'all'
                match = re.match(r'/projects/([^/]+)', path)
                affected |= bool(match and match[1] == pending.project_id)
                match = re.match(r'/sessions/([^/]+)', path)
                if match:
                    affected |= await db.scalar(select(SessionModel.project_id).where(SessionModel.id == match[1])) == pending.project_id
                affected |= project_id == pending.project_id
                if affected:
                    raise ConflictError('数据正在清理或等待重试，请到数据管理查看状态')
            yield

    async def interrupt(self):
        async with self.worker() as acquired:
            if not acquired:
                return
            async with self.factory() as db, db.begin():
                pending = await self.pending(db)
                if pending and pending.state == 'running':
                    pending.state, pending.error = 'failed', '服务曾中断，请到数据管理重试清理'

    async def latest(self, project_id=None):
        async with self.factory() as db:
            query = select(DataCleanupModel)
            if project_id:
                query = query.where(DataCleanupModel.project_id == project_id)
            row = await db.scalar(query.order_by(DataCleanupModel.created_at.desc()).limit(1))
            return row.to_domain() if row else None

    async def get(self, identifier):
        async with self.factory() as db:
            row = await db.get(DataCleanupModel, identifier)
            if row is None:
                raise NotFoundError('清理任务不存在')
            return row.to_domain()

    async def _inspect(self, db, project_id):
        projects = list((await db.scalars(select(ProjectModel).where(ProjectModel.id == project_id) if project_id else select(ProjectModel))).all())
        if project_id and not projects:
            raise NotFoundError('项目不存在')
        sessions = list((await db.scalars(select(SessionModel))).unique().all())
        targets = [item for item in sessions if not project_id or item.project_id == project_id]
        ids = {item.id for item in targets}
        project_ids = [item.id for item in projects]
        runs = list((await db.scalars(select(RunModel).where(RunModel.session_id.in_(ids)))).all()) if ids else []
        active = next((item for item in runs if item.status in ('running', 'waiting')), None)
        reason = '请先停止正在运行或等待处理的对话' if active else None
        if any(item.file_operation is not None for item in projects):
            reason = '请先结束项目文件操作或修复未完成的恢复'
        if any(item.summary_state == 'generating' for item in targets):
            reason = '请等待对话摘要生成结束'
        from app.application.services.context_operations import context_operation
        if any(context_operation(item.id)['status'] != 'idle' for item in targets):
            reason = '请等待上下文压缩结束'
        copies = list((await db.scalars(select(ProjectFileCopyModel))).all())
        events = list((await db.execute(select(EventModel.session_id, EventModel.payload))).all())
        owned, protected = set(), set()
        for item in sessions:
            refs = referenced_strings(item.files) | referenced_strings(item.memories)
            (owned if item.id in ids else protected).update(refs)
        for session_id, payload in events:
            (owned if session_id in ids else protected).update(referenced_strings(payload))
        for item in copies:
            (owned if item.project_id in project_ids else protected).add(item.attachment_id)
        all_files = list((await db.scalars(select(FileModel))).all())
        files = []
        for item in all_files:
            visual, uploaded = item.visual or {}, item.project_upload or {}
            belongs = item.id in owned or visual.get('session_id') in ids or uploaded.get('project_id') in project_ids
            if not project_id or (belongs and item.id not in protected):
                files.append(item.to_domain().model_dump(mode='json'))
        snapshots = list((await db.scalars(select(ProjectSnapshotModel.id).where(ProjectSnapshotModel.project_id.in_(project_ids)))).all()) if project_ids else []
        counts = dict(projects=len(projects), sessions=len(targets), files=len(files), snapshots=len(snapshots),
            bytes=sum(item.files_size for item in projects), memory=sum(bool(item.instructions or item.notes) for item in projects))
        manifest = dict(counts=counts, session_ids=sorted(ids), project_ids=project_ids, files=files,
            file_ids=[item['id'] for item in files],
            sandbox_ids=sorted({item.sandbox_id for item in targets if item.sandbox_id}),
            task_ids=sorted({item.task_id for item in targets if item.task_id}))
        return CleanupPreview(name=projects[0].name if project_id else '所有项目与对话', counts=counts,
            blocked_reason=reason, occupying_session_id=active.session_id if active else None), manifest

    async def preview(self, project_id=None):
        async with self.factory() as db:
            result, _ = await self._inspect(db, project_id)
            pending = await self.pending(db)
            if pending:
                result.task = pending.to_domain()
                result.blocked_reason = '已有未完成的数据清理，请先完成或重试'
            return result

    async def claim(self, project_id, confirmation):
        async with self.factory() as db, db.begin():
            if not await db.scalar(text('SELECT pg_try_advisory_xact_lock(:key)'), {'key': ADMISSION_LOCK}):
                raise ConflictError('有操作正在提交，请稍后重试')
            if await self.pending(db):
                raise ConflictError('已有未完成的数据清理，请读回状态并重试该任务')
            preview, manifest = await self._inspect(db, project_id)
            if preview.blocked_reason:
                raise ConflictError(preview.blocked_reason)
            expected = preview.name if project_id and any(preview.counts[key] for key in ('sessions', 'files', 'snapshots', 'bytes', 'memory')) else '' if project_id else '清空所有数据'
            if confirmation != expected:
                raise BadRequestError('确认文字不匹配，请重新确认')
            task_ids = manifest.pop('task_ids')
            # task_ids 属于资源清单，但不暴露给前端。
            manifest['task_ids'] = task_ids
            row = DataCleanupModel(id=str(uuid.uuid4()), scope='project' if project_id else 'all', project_id=project_id,
                name=preview.name, state='running', phase='resources', completed=0,
                total=len(manifest['project_ids'])+len(manifest['files'])+len(task_ids)+1+(0 if project_id else 1),
                manifest=manifest, created_at=datetime.now(), updated_at=datetime.now())
            db.add(row)
            await db.flush()
            return row.to_domain()

    async def update(self, identifier, **values):
        async with self.factory() as db, db.begin():
            row = await db.get(DataCleanupModel, identifier, with_for_update=True)
            for key, value in values.items():
                setattr(row, key, value)
            row.updated_at = datetime.now()

    async def finish(self, identifier):
        async with self.factory() as db, db.begin():
            row = await db.get(DataCleanupModel, identifier, with_for_update=True)
            manifest = row.manifest
            ids, projects = manifest['session_ids'], manifest['project_ids']
            await db.execute(delete(SessionModel).where(SessionModel.id.in_(ids)))
            for model in (ProjectFileCopyModel, ProjectSnapshotModel, ProjectAuditModel):
                await db.execute(delete(model).where(model.project_id.in_(projects)))
            await db.execute(delete(ProjectModel).where(ProjectModel.id.in_(projects)))
            await db.execute(delete(FileModel).where(FileModel.id.in_([file['id'] for file in manifest['files']])))
            row.state, row.phase, row.completed, row.error = 'completed', 'completed', row.total, None
            row.updated_at = datetime.now()
            # 完成任务只保留计数与删除标识，移除文件名、路径及资源清单。
            row.manifest = dict(counts=manifest['counts'], session_ids=ids, project_ids=projects, files=[], sandbox_ids=[], task_ids=[])
            row.manifest['file_ids'] = manifest['file_ids']
            if row.scope == 'all':
                history = list((await db.scalars(select(DataCleanupModel).where(DataCleanupModel.id != identifier))).all())
                row.manifest['file_ids'] = sorted(set(row.manifest['file_ids']).union(*(set(item.manifest.get('file_ids', [])) for item in history)))
                await db.execute(delete(DataCleanupModel).where(DataCleanupModel.id != identifier))
        from app.infrastructure.external.message_queue.catalog_notifier import publish_catalog
        await publish_catalog({('project', item) for item in projects} | {('session', item) for item in ids})
