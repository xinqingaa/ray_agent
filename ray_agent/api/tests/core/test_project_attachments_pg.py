"""真实 PG、磁盘与本地对象存储；Docker/模型为替身。"""
import io
from pathlib import Path
import pytest
from fastapi import UploadFile
from app.application.services.file_service import FileService
from app.application.services.project_attachment_service import ProjectAttachmentService
from app.domain.models.event import MessageEvent
from app.domain.models.run import RunStatus
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
from tests.core.test_w11_projects_pg import projects
from tests.core.test_project_snapshots_pg import files, Stopped
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')


def services(factory, tmp_path):
    service = projects(factory, tmp_path)
    fs = files(factory, service)
    storage = LocalFileStorage(str(tmp_path/'objects'), factory)
    uploads = FileService(factory, storage, project_files=fs)
    fs.attachments = ProjectAttachmentService(fs, storage)
    return service, fs, uploads


async def upload(uploads, fs, pid, name, data, **kwargs):
    return await uploads.upload_file(UploadFile(file=io.BytesIO(data), filename=name, size=1),
        project_id=pid, rule_version=fs.upload_rules()['version'], **kwargs)


async def accept(factory, fs, project, session, uploaded):
    ledger = RunLedger(factory)
    event = MessageEvent(role='user', message='读取附件', attachments=[uploaded])
    async def apply(uow):
        run = await uow.run.get_active(session.id)
        await fs.attachments.stage(uow, project.id, session.id, run.id, event)
    return await ledger.start(session.id, events_after=[event], apply=apply)


def test_actual_upload_checks_and_atomic_accept_then_publish_before_snapshot(tmp_path):
    async def scenario(factory, engine):
        service, fs, uploads = services(factory, tmp_path)
        project = await service.create('项目附件'); session = await service.create_session(project.id)
        with pytest.raises(Exception, match='明确确认'):
            await upload(uploads, fs, project.id, '.env', b'example')
        with pytest.raises(Exception, match='排除项'):
            await upload(uploads, fs, project.id, '.git', b'example', include_optional=True)
        with pytest.raises(Exception, match='单一文件名'):
            await upload(uploads, fs, project.id, '../secret', b'example')
        uploaded = await upload(uploads, fs, project.id, '材料.csv', b'x,y\n1,2\n')
        assert uploaded.size == 8 and uploaded.sha256
        run = await accept(factory, fs, project, session, uploaded)
        async with factory() as uow:
            copy = await uow.project.file_copy(project.id, 'attachment:'+uploaded.id)
            events = await uow.event.list(session.id, types=['message'])
        assert copy.state == 'pending' and copy.path is None
        assert copy.message_seq == events[0].seq and copy.run_id == run.id
        assert not list(fs.file_io(project.id).walk())
        protection = await fs.prepare_run(project.id, session.id, run.id)
        async with factory() as uow:
            copy = await uow.project.file_copy(project.id, copy.copy_key)
        assert copy.state == 'ready' and copy.path == 'uploads/材料.csv'
        assert (Path(fs.file_io(project.id).root)/copy.path).read_bytes() == b'x,y\n1,2\n'
        assert copy.path in fs.disk(project.id).load((await fs.snapshots(project.id))[0])
        assert protection['state'] == 'ready'
        again = await fs.attachments.publish(project.id, uploaded.id, run.id)
        assert again.path == copy.path
        assert len([e for e in fs.file_io(project.id).walk() if e.type=='file']) == 1
    with_db(scenario)


def test_same_name_new_ids_rename_and_snapshot_lock_defers_injection(tmp_path):
    async def scenario(factory, engine):
        import asyncio
        from app.domain.services.project_file_coordinator import project_io_lock
        service, fs, uploads = services(factory, tmp_path)
        project = await service.create('追加附件'); session = await service.create_session(project.id)
        first = await upload(uploads, fs, project.id, 'same.txt', b'one')
        run = await accept(factory, fs, project, session, first)
        await fs.prepare_run(project.id, session.id, run.id)
        second = await upload(uploads, fs, project.id, 'same.txt', b'two')
        event = MessageEvent(role='user', message='追加', attachments=[second])
        async def stage(uow):
            await fs.attachments.stage(uow, project.id, session.id, run.id, event)
        await RunLedger(factory).append(session.id, [event], run_id=run.id, apply=stage)
        async with project_io_lock(project.id):
            task = asyncio.create_task(fs.attachments.publish(project.id, second.id, run.id))
            await asyncio.sleep(0)
            assert not task.done()
        copied = await task
        assert copied.path == 'uploads/same (1).txt'
        manifest = fs.disk(project.id).load((await fs.snapshots(project.id))[0])
        assert copied.path not in manifest
        assert (Path(fs.file_io(project.id).root)/'uploads/same.txt').read_bytes() == b'one'
    with_db(scenario)


def test_accept_rollback_creates_no_pending_or_message_and_unknown_publish_readback(tmp_path):
    async def scenario(factory, engine):
        service, fs, uploads = services(factory, tmp_path)
        project = await service.create('事务故障'); session = await service.create_session(project.id)
        uploaded = await upload(uploads, fs, project.id, 'a.txt', b'abc')
        event = MessageEvent(role='user', message='读取', attachments=[uploaded])
        async def fail(uow):
            run = await uow.run.get_active(session.id)
            await fs.attachments.stage(uow, project.id, session.id, run.id, event)
            raise OSError('注入受理事务失败')
        with pytest.raises(OSError):
            await RunLedger(factory).start(session.id, events_after=[event], apply=fail)
        async with factory() as uow:
            assert not await uow.project.file_copies(project.id)
            assert not await uow.event.list(session.id)
        run = await accept(factory, fs, project, session, uploaded)
        # 模拟发布成功、ready 结果未知：持久路径仍 pending，按哈希补 ready。
        async with factory() as uow:
            copy = await uow.project.file_copy(project.id, 'attachment:'+uploaded.id)
            copy.path = 'uploads/a.txt'
            await uow.project.save_file_copy(copy)
        fs.file_io(project.id).publish(copy.path, io.BytesIO(b'abc'))
        await RunLedger(factory).transition(session.id, run.id, RunStatus.INTERRUPTED)
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        await ProjectFileCoordinator(factory, Stopped).settle(project.id)
        await fs.attachments.reconcile_startup()
        async with factory() as uow:
            copied = await uow.project.file_copy(project.id, copy.copy_key)
        assert copied.state == 'ready'
        assert len([e for e in fs.file_io(project.id).walk() if e.type=='file']) == 1
    with_db(scenario)


def test_startup_preserves_accepted_pending_and_ready_but_cleans_only_orphan(tmp_path):
    async def scenario(factory, engine):
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        service, fs, uploads = services(factory, tmp_path)
        project = await service.create('启动核对'); session = await service.create_session(project.id)
        uploaded = await upload(uploads, fs, project.id, 'ready.txt', b'ready')
        run = await accept(factory, fs, project, session, uploaded)
        await fs.prepare_run(project.id, session.id, run.id)
        async with factory() as uow:
            ready = (await uow.project.file_copies(project.id))[0]
            orphan = ready.model_copy(update={'copy_key':'attachment:orphan', 'attachment_id':'orphan',
                'state':'pending', 'path':'uploads/orphan.txt', 'message_seq':999})
            await uow.project.save_file_copy(orphan)
        fs.file_io(project.id).publish(orphan.path, io.BytesIO(b'ready'))
        pending_file = await upload(uploads, fs, project.id, 'pending.txt', b'pending')
        event = MessageEvent(role='user', message='追加', attachments=[pending_file])
        async def stage(uow):
            await fs.attachments.stage(uow, project.id, session.id, run.id, event)
        ledger = RunLedger(factory)
        await ledger.append(session.id, [event], run_id=run.id, apply=stage)
        await ledger.transition(session.id, run.id, RunStatus.INTERRUPTED)
        await ProjectFileCoordinator(factory, Stopped).settle(project.id)
        await fs.attachments.reconcile_startup()
        async with factory() as uow:
            copies = await uow.project.file_copies(project.id)
        assert len(copies) == 2
        assert any(c.state=='ready' and c.copy_key==ready.copy_key for c in copies)
        pending = next(c for c in copies if c.state=='pending')
        assert '中断' in pending.error
        assert not (Path(fs.file_io(project.id).root)/orphan.path).exists()
        assert (Path(fs.file_io(project.id).root)/ready.path).read_bytes() == b'ready'
    with_db(scenario)


def test_known_ready_rejection_cleans_only_new_copy_and_keeps_pending_for_retry(tmp_path):
    async def scenario(factory, engine):
        from sqlalchemy.exc import IntegrityError
        from app.infrastructure.repositories.db_uow import DBUnitOfWork
        service, fs, uploads = services(factory, tmp_path)
        project = await service.create('落盘拒绝'); session = await service.create_session(project.id)
        uploaded = await upload(uploads, fs, project.id, 'a.txt', b'abc')
        run = await accept(factory, fs, project, session, uploaded)
        rejected = {'once': True}
        original_factory = fs.attachments.factory
        class RejectReady:
            async def __aenter__(self):
                self.uow = original_factory()
                result = await self.uow.__aenter__()
                original_save = result.project.save_file_copy
                async def save(copy):
                    if copy.state == 'ready' and rejected['once']:
                        rejected['once'] = False
                        raise IntegrityError('injected', None, Exception('注入 ready 约束拒绝'))
                    await original_save(copy)
                result.project.save_file_copy = save
                return result
            async def __aexit__(self, *args):
                return await self.uow.__aexit__(*args)
        fs.attachments.factory = RejectReady
        with pytest.raises(IntegrityError):
            await fs.attachments.publish(project.id, uploaded.id, run.id)
        async with factory() as uow:
            copy = await uow.project.file_copy(project.id, 'attachment:'+uploaded.id)
        assert copy.state == 'pending' and copy.path is None
        assert not [e for e in fs.file_io(project.id).walk() if e.type=='file']
        ready = await fs.attachments.publish(project.id, uploaded.id, run.id)
        assert ready.state == 'ready'
        assert (Path(fs.file_io(project.id).root)/ready.path).read_bytes() == b'abc'
    with_db(scenario)
