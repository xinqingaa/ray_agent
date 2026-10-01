"""真实 PG + 真实临时磁盘；Docker/模型为替身。"""
import asyncio
import io
import threading
from pathlib import Path
import pytest
from app.application.services.project_file_service import ProjectFileService
from app.domain.models.run import RunStatus
from app.domain.services.project_file_coordinator import ProjectFileCoordinator
from app.domain.services.project_operations import claim
from app.domain.services.project_transactions import ProjectRunConflict
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk, SnapshotLimitError
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
from tests.core.test_w11_projects_pg import projects
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立临时 PostgreSQL')


class Stopped:
    @classmethod
    async def stop_project_writers(cls, project_id):
        pass


def files(factory, service, **kwargs):
    return ProjectFileService(factory, service._storage, Stopped,
        max_bytes=kwargs.pop('max_bytes', 1024), ledger=RunLedger(factory), **kwargs)


async def snapshot_run(factory, service, fs, project, session):
    ledger = RunLedger(factory)
    run = await ledger.start(session.id)
    result = await fs.prepare_run(project.id, session.id, run.id)
    await ledger.transition(session.id, run.id, RunStatus.COMPLETED)
    assert await ProjectFileCoordinator(factory, Stopped).settle(project.id)
    return result


def test_ready_registration_retention_one_restore_and_archived_cleanup(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('快照项目')
        session = await service.create_session(project.id)
        fs = files(factory, service, retention=lambda: 1)
        disk = fs.disk(project.id)
        disk.files.publish('source', io.BytesIO(b'original'))
        protection = await snapshot_run(factory, service, fs, project, session)
        target = (await fs.snapshots(project.id))[0]
        assert protection['snapshot_id'] == target.id
        disk.files.publish('source', io.BytesIO(b'changed'), overwrite=True)
        disk.files.publish('extra/new', io.BytesIO(b'extra'))
        root = Path(disk.files.root); inode = root.stat().st_ino
        result = await fs.restore(project.id, target.id)
        assert result['total_bytes'] == len(b'original')
        assert root.stat().st_ino == inode
        assert (root/'source').read_bytes() == b'original' and not (root/'extra').exists()
        snapshots = await fs.snapshots(project.id)
        assert len([s for s in snapshots if s.source == 'run']) == 1
        assert len([s for s in snapshots if s.source == 'restore']) == 1
        assert (await service.get(project.id)).file_operation is None
        await snapshot_run(factory, service, fs, project, session)
        assert len([s for s in await fs.snapshots(project.id) if s.source == 'run']) == 1
        with pytest.raises(Exception, match='归档'):
            await fs.cleanup(project.id)
        await service.archive(project.id, True)
        cleaned = await fs.cleanup(project.id)
        assert cleaned['released_bytes'] > 0
        assert not await fs.snapshots(project.id)
        assert (root/'source').read_bytes() == b'original'
        assert (await service.detail(project.id))['task_count'] == 1
        assert (await service.get(project.id)).snapshots_cleaned_at is not None
    with_db(scenario)


@pytest.mark.parametrize('return_before', [False, True])
def test_failed_apply_blocks_and_both_repairs_use_original_fixed_manifests(tmp_path, return_before):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('恢复故障')
        session = await service.create_session(project.id)
        failure = {'enabled': False}
        def disk_factory(storage, project_id, **kwargs):
            def fault(phase, path):
                if failure['enabled'] and phase == 'overwrite':
                    raise OSError('注入覆盖错误')
            return SnapshotDisk(storage, project_id, fault_hook=fault, **kwargs)
        fs = files(factory, service, disk_factory=disk_factory, retention=lambda: 1)
        disk = fs.disk(project.id)
        disk.files.publish('source', io.BytesIO(b'original'))
        await snapshot_run(factory, service, fs, project, session)
        target = (await fs.snapshots(project.id))[0]
        disk.files.publish('source', io.BytesIO(b'changed'), overwrite=True)
        disk.files.publish('extra', io.BytesIO(b'extra'))
        failure['enabled'] = True
        with pytest.raises(OSError):
            await fs.restore(project.id, target.id)
        op = (await service.get(project.id)).file_operation
        assert op.kind == 'restore' and op.state == 'failed' and op.phase == 'applying'
        assert op.target_snapshot_id == target.id and op.before_snapshot_id
        with pytest.raises(ProjectRunConflict):
            await RunLedger(factory).start(session.id)
        with pytest.raises(ProjectRunConflict):
            await service.archive(project.id, True)
        old_ids = {s.id for s in await fs.snapshots(project.id)}
        await fs.reconcile_startup()
        assert (await service.get(project.id)).file_operation.state == 'failed'
        assert {s.id for s in await fs.snapshots(project.id)} == old_ids
        failure['enabled'] = False
        await fs.repair_restore(project.id, op.operation_id, return_before=return_before)
        root = Path(disk.files.root)
        assert (root/'source').read_bytes() == (b'changed' if return_before else b'original')
        assert (root/'extra').exists() == return_before
        assert {s.id for s in await fs.snapshots(project.id)} == old_ids
        assert (await service.get(project.id)).file_operation is None
    with_db(scenario)


def test_run_skip_protection_event_and_required_snapshot_limit(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('超限保护')
        session = await service.create_session(project.id)
        fs = files(factory, service, max_bytes=4)
        fs.disk(project.id).files.publish('source', io.BytesIO(b'large'))
        ledger = RunLedger(factory)
        run = await ledger.start(session.id)
        protection = await fs.prepare_run(project.id, session.id, run.id)
        assert protection['state'] == 'skipped' and protection['snapshot_id'] is None
        async with factory() as uow:
            events = await uow.event.list(session.id, types=['environment'])
            stored = await uow.run.get(run.id)
        assert events[-1].project_file_protection['state'] == 'skipped'
        assert stored.config_snapshot['project_file_protection']['state'] == 'skipped'
        await ledger.transition(session.id, run.id, RunStatus.COMPLETED)
        await ProjectFileCoordinator(factory, Stopped).settle(project.id)
        with pytest.raises(SnapshotLimitError):
            async with factory() as uow:
                op = await claim(uow, project.id, 'upload')
            try:
                await fs._capture(project.id, op.operation_id, 'upload')
            finally:
                await fs.reconcile_operation(project.id, op.operation_id, startup=True)
        assert not await fs.snapshots(project.id)
        assert (Path(fs.disk(project.id).files.root)/'source').read_bytes() == b'large'
    with_db(scenario)


def test_cancelled_snapshot_thread_keeps_ownership_until_exit_and_retains_ready(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('线程停止')
        session = await service.create_session(project.id)
        entered, release = threading.Event(), threading.Event()
        def disk_factory(storage, project_id, **kwargs):
            def fault(phase, path):
                if phase == 'before_manifest':
                    entered.set()
                    assert release.wait(5)
            return SnapshotDisk(storage, project_id, fault_hook=fault, **kwargs)
        fs = files(factory, service, disk_factory=disk_factory)
        fs.disk(project.id).files.publish('source', io.BytesIO(b'original'))
        ledger = RunLedger(factory); run = await ledger.start(session.id)
        worker = asyncio.create_task(fs.prepare_run(project.id, session.id, run.id))
        await asyncio.to_thread(entered.wait, 5)
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED)
        worker.cancel()
        await asyncio.sleep(0)
        assert not worker.done()
        with pytest.raises(ProjectRunConflict):
            await ledger.start(session.id)
        assert (await service.get(project.id)).file_operation.kind == 'snapshot'
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await worker
        assert len(await fs.snapshots(project.id)) == 1
        assert (await service.get(project.id)).file_operation.kind == 'settling'
        await ProjectFileCoordinator(factory, Stopped).settle(project.id)
        assert (await service.get(project.id)).file_operation is None
    with_db(scenario)
