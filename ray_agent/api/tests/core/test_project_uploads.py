"""规则与真实 PostgreSQL 批次测试；磁盘真实，Docker 停止为替身。"""
import io
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
import pytest
from core.config import Settings
from app.domain.models.project_upload import ProjectUploadSelection
from app.domain.services.project_upload_rules import classify, rules, validate_paths
from app.domain.services.project_transactions import ProjectRunConflict
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.project.snapshot_disk import SnapshotLimitError
from tests.core.test_run_events_pg import PG_URI, with_db
from tests.core.test_w11_projects_pg import projects
from tests.core.test_project_snapshots_pg import files


@pytest.fixture(autouse=True)
def fresh_schema():
    # 本文件也有不需要 PG 的规则用例，不能无配置时调用数据库 fixture。
    if PG_URI:
        from tests.core import test_run_events_pg as pg_tests
        yield from pg_tests.fresh_schema.__wrapped__()
    else:
        yield


def item(path, data, **kwargs):
    return dict(path=path, size=len(data), sha256=hashlib.sha256(data).hexdigest(), **kwargs)


def selection(fs, items, **kwargs):
    return ProjectUploadSelection(rule_version=fs.upload_rules()['version'], items=items, **kwargs)


@pytest.mark.parametrize('path,inventory,policy', [
    ('.git/config', [], 'always'), ('a/.DS_Store', [], 'always'),
    ('node_modules/x', [], 'optional'), ('build/readme', [], 'include'),
    ('build/readme', ['package.json'], 'optional'), ('a/dist/x', ['a/package.json'], 'optional'),
    ('a/dist/x', ['package.json'], 'include'), ('env/x', ['env/pyvenv.cfg'], 'optional'),
    ('target/x', ['Cargo.toml'], 'optional'), ('target/x', [], 'include'),
    ('.env.production', [], 'optional'), ('private.KEY', [], 'optional'),
])
def test_rules(path, inventory, policy):
    rule = rules(Settings(_env_file=None))
    assert classify(path, set(inventory), rule)['policy'] == policy


def test_invalid_paths_and_nfc_duplicates():
    rule = rules(Settings(_env_file=None))
    for path in ('../x', '/tmp/x', 'a/../b'):
        with pytest.raises(ValueError):
            ProjectUploadSelection(rule_version=rule['version'], items=[item(path, b'x')])
    duplicate = ProjectUploadSelection(rule_version=rule['version'], items=[item('e\u0301', b'x'), item('é', b'x')])
    with pytest.raises(ValueError, match='重复'):
        validate_paths(duplicate)
    collision = ProjectUploadSelection(rule_version=rule['version'], items=[item('a', b'x'), item('a/b', b'x')])
    with pytest.raises(ValueError, match='冲突'):
        validate_paths(collision)


@pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')
def test_batch_ownership_protection_actual_hash_retry_and_result(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path); project = await service.create('上传批次')
        session = await service.create_session(project.id); fs = files(factory, service)
        store = fs.file_io(project.id); store.publish('source', io.BytesIO(b'old'))
        chosen = selection(fs, [item('source', b'new', overwrite=True), item('nested/second', b'two')])
        pre = await fs.preflight_upload(project.id, chosen)
        chosen.fingerprint = pre['fingerprint']
        op = await fs.start_upload(project.id, chosen); opid = op['operation_id']
        before = op['before_snapshot_id']; assert before
        assert (await fs.snapshots(project.id))[0].source == 'upload'
        with pytest.raises(ProjectRunConflict):
            await RunLedger(factory).start(session.id)
        with pytest.raises(ProjectRunConflict):
            await fs.start_upload(project.id, chosen)
        with pytest.raises(ProjectRunConflict):
            await fs.restore(project.id, before)
        with pytest.raises(ProjectRunConflict):
            await service.archive(project.id, True)
        bad = await fs.upload_item(project.id, opid, 'source', io.BytesIO(b'bad'))
        assert not bad['published']
        assert (Path(store.root)/'source').read_bytes() == b'old'
        good = await fs.upload_item(project.id, opid, 'source', io.BytesIO(b'new'))
        assert good['published'] and not good['reused']
        # 响应丢失重试先核对已发布文件，仍校验本次实际字节。
        bad_reuse = await fs.upload_item(project.id, opid, 'source', io.BytesIO(b'bad'))
        assert not bad_reuse['published']
        reuse = await fs.upload_item(project.id, opid, 'source', io.BytesIO(b'new'))
        assert reuse['reused']
        assert (await service.get(project.id)).file_operation.operation_id == opid
        assert (await fs.upload_item(project.id, opid, 'nested/second', io.BytesIO(b'two')))['published']
        final = await fs.end_upload(project.id, opid)
        assert final['results']['batch_status'] == 'completed'
        assert (await service.get(project.id)).file_operation is None
        history = await fs.operation_result(project.id, opid)
        assert history['results']['received']['source']['published']
        assert (await service.get(project.id)).files_size == 6
        await fs.restore(project.id, before)
        assert (Path(store.root)/'source').read_bytes() == b'old'
        assert not (Path(store.root)/'nested').exists()
    with_db(scenario)


@pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')
def test_preflight_changed_rules_conflicts_and_mandatory_protection(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path); project = await service.create('预检')
        fs = files(factory, service, max_bytes=4)
        store = fs.file_io(project.id); store.publish('source', io.BytesIO(b'large'))
        chosen = selection(fs, [item('source', b'new', overwrite=True)])
        chosen.fingerprint = (await fs.preflight_upload(project.id, chosen))['fingerprint']
        with pytest.raises(SnapshotLimitError):
            await fs.start_upload(project.id, chosen)
        assert (Path(store.root)/'source').read_bytes() == b'large'
        assert (await service.get(project.id)).file_operation is None
        fs = files(factory, service)
        chosen = selection(fs, [item('source', b'new', overwrite=True)])
        chosen.fingerprint = (await fs.preflight_upload(project.id, chosen))['fingerprint']
        store.publish('source', io.BytesIO(b'other'), overwrite=True)
        with pytest.raises(Exception, match='冲突已变化'):
            await fs.start_upload(project.id, chosen)
        assert (await service.get(project.id)).file_operation is None
        chosen.rule_version = 'old'
        with pytest.raises(Exception, match='规则已变化'):
            await fs.start_upload(project.id, chosen)
        assert (await service.get(project.id)).file_operation is None
        chosen = selection(fs, [item('a/.git/config', b'x')], include_optional=['a/.git'])
        with pytest.raises(Exception, match='排除项'):
            await fs.start_upload(project.id, chosen)
        assert (await service.get(project.id)).file_operation is None
    with_db(scenario)


@pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')
@pytest.mark.parametrize('ending', ['cancel', 'expire', 'restart'])
def test_partial_upload_converges_without_undoing_published_files(tmp_path, ending):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path); project = await service.create('部分上传')
        fs = files(factory, service)
        chosen = selection(fs, [item('a', b'a'), item('b', b'b')])
        chosen.fingerprint = (await fs.preflight_upload(project.id, chosen))['fingerprint']
        op = await fs.start_upload(project.id, chosen); opid = op['operation_id']
        await fs.upload_item(project.id, opid, 'a', io.BytesIO(b'a'))
        if ending == 'cancel':
            await fs.end_upload(project.id, opid, cancel=True)
        elif ending == 'expire':
            async with factory() as uow:
                p = await uow.project.get(project.id, lock=True)
                p.file_operation.last_active_at = datetime.now() - timedelta(seconds=601)
                await uow.project.save(p)
            await fs.expire_uploads()
        else:
            await fs.reconcile_startup()
        assert (await service.get(project.id)).file_operation is None
        result = await fs.operation_result(project.id, opid)
        assert result['results']['received']['a']['published']
        assert not result['results']['received']['b']['published']
        assert (Path(fs.file_io(project.id).root)/'a').read_bytes() == b'a'
        assert not (Path(fs.file_io(project.id).root)/'b').exists()
    with_db(scenario)


@pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')
def test_reused_item_needs_no_body_and_stopped_size_cache(tmp_path):
    async def scenario(factory, engine):
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        from tests.core.test_project_snapshots_pg import Stopped
        service = projects(factory, tmp_path); project = await service.create('相同内容复用')
        fs = files(factory, service); store = fs.file_io(project.id)
        store.publish('source', io.BytesIO(b'old'))
        chosen = selection(fs, [item('source', b'old')])
        chosen.fingerprint = (await fs.preflight_upload(project.id, chosen))['fingerprint']
        op = await fs.start_upload(project.id, chosen)
        assert op['results']['received']['source']['reused']
        assert not await fs.snapshots(project.id)
        result = await fs.end_upload(project.id, op['operation_id'])
        assert result['results']['batch_status'] == 'completed'
        store.publish('extra', io.BytesIO(b'extra'))
        coordinator = ProjectFileCoordinator(factory, Stopped, fs.measure_size)
        assert await coordinator.settle(project.id)
        cached = await service.get(project.id)
        assert cached.files_size == 8 and not cached.files_size_stale
    with_db(scenario)
