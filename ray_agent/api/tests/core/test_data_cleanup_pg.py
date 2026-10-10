"""使用独立 PostgreSQL 和临时文件验证真实删除、准入及可重试清单。"""
import asyncio
from datetime import datetime
from types import SimpleNamespace
import pytest
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import async_sessionmaker
from app.application.errors.exceptions import ConflictError, BadRequestError
from app.application.services.data_cleanup_service import DataCleanupService
from app.domain.models.file import File
from app.domain.models.run import Run
from app.infrastructure.models import ProjectModel, SessionModel, FileModel, RunModel, EventModel
from app.infrastructure.models.project import ProjectAuditModel, ProjectSnapshotModel
from app.infrastructure.models.data_cleanup import DataCleanupModel
from app.infrastructure.repositories.db_data_cleanup_repository import DBDataCleanupRepository, ADMISSION_LOCK
from app.infrastructure.repositories.db_file_repository import DBFileRepository
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage
from app.infrastructure.external.project.data_cleanup_resources import DataCleanupResources
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db

pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立临时 PostgreSQL')


async def seed(factory, root):
    async with factory() as db, db.begin():
        db.add_all([ProjectModel(id='p1', name='学习项目', notes='记录'), ProjectModel(id='p2', name='保留项目')])
        await db.flush()
        db.add_all([SessionModel(id='s1', project_id='p1', status='completed', files=[{'id':'own'}, {'id':'shared'}]),
            SessionModel(id='s2', project_id='p2', status='completed', files=[{'id':'shared'}])])
        await db.flush()
        db.add_all([FileModel.from_domain(File(id=id, filename=id+'.txt', key='2026/'+id+'.txt', size=4)) for id in ('own', 'shared', 'old', 'orphan')])
        db.add(EventModel(session_id='s1', seq=1, type='message', payload={'attachments':[{'id':'old'}]}, created_at=datetime.now()))
        db.add(ProjectAuditModel(project_id='p1', seq=1, type='project_notes', payload={'content':'记录'}, created_at=datetime.now()))
        db.add(ProjectSnapshotModel(id='snapshot', project_id='p1', source='run', total_bytes=4, manifest_sha256='a'*64, created_at=datetime.now()))
    for id in ('own', 'shared', 'old', 'orphan'):
        path = root/'2026'/(id+'.txt'); path.parent.mkdir(parents=True, exist_ok=True); path.write_text('data')
    storage = ManagedProjectStorage(str(root), local_bind=str(root)); storage.initialize(in_container=False)
    for id in ('p1','p2'):
        storage.ensure_project(id); (storage.files_path(id)/'file.txt').write_text('project')
    settings = SimpleNamespace(sandbox_address=None, sandbox_name_prefix='rayagent-test', file_storage_backend='local')
    async def keys(**kwargs):
        for key in []: yield key
    redis = SimpleNamespace(delete=lambda key: asyncio.sleep(0),scan_iter=keys)
    resources = DataCleanupResources(storage, LocalFileStorage(str(root), lambda: None), settings, redis)
    resources.sandboxes = lambda task: asyncio.sleep(0)
    return resources


def test_project_cleanup_preserves_other_project_shared_files_and_retries(tmp_path):
    async def scenario(uow_factory, engine):
        factory=async_sessionmaker(engine, autoflush=False)
        resources=await seed(factory,tmp_path)
        repo=DBDataCleanupRepository(factory); service=DataCleanupService(repo,resources)
        preview=await repo.preview('p1')
        assert preview.counts['sessions']==1 and preview.counts['files']==2 and preview.counts['snapshots']==1
        with pytest.raises(BadRequestError): await repo.claim('p1','错误名称')
        task=await repo.claim('p1','学习项目')
        assert not {'files','sandbox_ids','task_ids'} & task.model_dump().keys()
        with pytest.raises(ConflictError): await repo.claim(None,'清空所有数据')
        for path,project_id in [('/projects/p1/uploads',None),('/sessions/s1/chat',None),('/sessions','p1'),('/files','p1')]:
            with pytest.raises(ConflictError):
                async with repo.admission(path,project_id): pass
        async with repo.admission('/sessions/s2/chat'): pass
        async with repo.admission('/projects'): pass
        original=resources.attachment
        async def failed(file): raise OSError('模拟存储失败')
        resources.attachment=failed
        await service.execute(task.id)
        failed_task=await repo.get(task.id)
        assert failed_task.state=='failed' and failed_task.completed==2
        async with factory() as db:
            assert await db.get(ProjectModel,'p1') is not None
            assert await db.get(SessionModel,'s1') is not None
        resources.attachment=original
        await service.execute(task.id)
        await service.execute(task.id)
        result=await repo.get(task.id)
        assert result.state=='completed' and result.completed==result.total
        async with factory() as db:
            assert await db.get(ProjectModel,'p1') is None and await db.get(SessionModel,'s1') is None
            assert await db.get(ProjectModel,'p2') is not None and await db.get(SessionModel,'s2') is not None
            assert set((await db.scalars(select(FileModel.id))).all())=={'shared','orphan'}
            assert await db.scalar(select(func.count()).select_from(EventModel))==0
            assert await db.scalar(select(func.count()).select_from(ProjectSnapshotModel))==0
            with pytest.raises(ConflictError):
                await DBFileRepository(db).save(File(id='own', key='2026/own.txt'))
        assert not (tmp_path/'projects'/'p1').exists()
        assert (tmp_path/'projects'/'p2'/'files'/'file.txt').exists()
        assert (tmp_path/'2026'/'shared.txt').exists() and not (tmp_path/'2026'/'old.txt').exists()
    with_db(scenario)


def test_reset_clears_all_registered_data_and_preserves_config(tmp_path):
    async def scenario(uow_factory, engine):
        factory=async_sessionmaker(engine, autoflush=False)
        resources=await seed(factory,tmp_path)
        config=tmp_path/'config.yaml'; config.write_text('model: unchanged')
        repo=DBDataCleanupRepository(factory);service=DataCleanupService(repo,resources)
        task=await repo.claim(None,'清空所有数据')
        for path in ('/projects','/sessions','/files'):
            with pytest.raises(ConflictError):
                async with repo.admission(path): pass
        assert task.counts['projects']==2 and task.counts['files']==4
        await service.execute(task.id)
        assert (await repo.get(task.id)).state=='completed'
        async with factory() as db:
            for model in (ProjectModel,SessionModel,RunModel,EventModel,FileModel,ProjectAuditModel,ProjectSnapshotModel):
                assert await db.scalar(select(func.count()).select_from(model))==0
            assert await db.scalar(select(func.count()).select_from(DataCleanupModel))==1
        assert config.read_text()=='model: unchanged'
        assert not list((tmp_path/'2026').glob('*.txt'))
    with_db(scenario)


def test_active_run_file_operation_and_concurrent_admission_rejected(tmp_path):
    async def scenario(uow_factory, engine):
        factory=async_sessionmaker(engine, autoflush=False)
        await seed(factory,tmp_path); repo=DBDataCleanupRepository(factory)
        async with factory() as db,db.begin(): db.add(RunModel.from_domain(Run(session_id='s1')))
        assert (await repo.preview('p1')).occupying_session_id=='s1'
        with pytest.raises(ConflictError): await repo.claim('p1','学习项目')
        async with factory() as db,db.begin():
            run=await db.scalar(select(RunModel)); run.status='completed'
            project=await db.get(ProjectModel,'p1'); project.file_operation={'kind':'upload'}
        with pytest.raises(ConflictError): await repo.claim('p1','学习项目')
        async with factory() as db,db.begin(): (await db.get(ProjectModel,'p1')).file_operation=None
        async with factory() as db,db.begin():
            await db.execute(text('SELECT pg_advisory_xact_lock_shared(:key)'),{'key':ADMISSION_LOCK})
            with pytest.raises(ConflictError): await repo.claim('p1','学习项目')
        results=await asyncio.gather(repo.claim('p1','学习项目'),repo.claim(None,'清空所有数据'),return_exceptions=True)
        assert sum(not isinstance(result,Exception) for result in results)==1
        assert sum(isinstance(result,ConflictError) for result in results)==1
    with_db(scenario)
