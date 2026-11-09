"""组件的真实 SQLite 受理与恢复；显式启用时验证真实 worker、Chromium 和受管解释器。"""
import asyncio
import os
import shutil
import tempfile
import time
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.application.errors.exceptions import ConflictError
from app.application.services.background_jobs import BackgroundJobRunner, JobContext, JobSuperseded
from app.application.services.component_service import ComponentService
from app.domain.models.operation import OperationKind, OperationStatus
from app.infrastructure.external.components.local_components import BROWSER_ID, LocalRuntimeComponents
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import ensure_supervisor, stop_supervisor
from app.interfaces.endpoints import component_routes, operation_routes
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_component_service
from tests.support.sqlite_db import with_database


def setup(root, write, read, instance='instance-1', executor_factory=None):
    components = LocalRuntimeComponents(root / 'components')
    jobs = BackgroundJobRunner(write, instance, read_uow_factory=read)
    service = ComponentService(components, write, read, jobs, executor_factory)
    jobs.register(OperationKind.COMPONENT_INSTALL, service.process, requeue_on_restart=True)
    return components, jobs, service


async def claim(write, owner='instance-1'):
    async with write() as uow:
        return await uow.job.claim(owner, [OperationKind.COMPONENT_INSTALL])


def test_request_identity_http_and_reopen(tmp_path, monkeypatch):
    async def check(write, read, _):
        components, jobs, service = setup(tmp_path, write, read)
        app = FastAPI()
        app.include_router(component_routes.router, prefix='/api')
        app.include_router(operation_routes.router, prefix='/api')
        register_exception_handlers(app)
        app.dependency_overrides[get_component_service] = lambda: service
        monkeypatch.setattr(operation_routes, 'get_job_runner', lambda: jobs)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/components/browser-chromium/install', json={'request_id': 'request-1'})
            assert response.status_code == 200, response.text
            accepted = response.json()['data']
            repeated = await client.post('/api/components/browser-chromium/install', json={'request_id': 'request-1'})
            assert repeated.json()['data']['operation_id'] == accepted['operation_id']
            assert (await client.post('/api/components/ocr/install', json={'request_id': 'request-1'})).status_code == 409
            assert (await client.post('/api/components/unknown/install', json={'request_id': 'request-2'})).status_code == 404
            assert (await client.post('/api/components/ocr/install', json={})).status_code == 422
            # 新服务没有内存映射，仍能读回同一身份并取消／按同身份重试。
            _, reopened_jobs, reopened = setup(tmp_path, write, read)
            assert (await reopened.accept(BROWSER_ID, 'request-1')).operation_id == accepted['operation_id']
            view = next(row for row in await reopened.list() if row['component_id'] == BROWSER_ID)
            assert view['state'].value == 'fetching' and view['operation'].operation_id == accepted['operation_id']
            cancelled = (await client.post(f"/api/operations/{accepted['operation_id']}/cancel")).json()['data']
            assert cancelled['status'] == 'cancelled' and cancelled['can_retry']
            retried = (await client.post(f"/api/operations/{accepted['operation_id']}/retry")).json()['data']
            assert retried['generation'] == 2 and retried['operation_id'] == accepted['operation_id']
            with pytest.raises(ConflictError):
                await service.accept(BROWSER_ID, 'another-request')
    with_database(tmp_path, check)


def fake_files(components, target):
    target.mkdir(parents=True, exist_ok=True)
    from app.infrastructure.external.components.local_components import load_component_files
    for path in load_component_files()[BROWSER_ID]['required']:
        dest = target / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text('fixture')


def test_failed_partial_then_retry_and_atomic_publish(tmp_path):
    async def check(write, read, _):
        components, jobs, service = setup(tmp_path, write, read)
        job = await service.accept(BROWSER_ID, 'install')
        async def failed(context, action, component_id, target):
            fake_files(components, target)
            if action == 'verify':
                raise RuntimeError('校验失败')
        service._worker = failed
        await jobs.run_job(await claim(write))
        first = await jobs.get(job.operation_id)
        assert first.status is OperationStatus.FAILED and first.can_retry and '校验失败' in first.error.message
        assert components.current(BROWSER_ID) is None
        async def good(context, action, component_id, target):
            fake_files(components, target)
        service._worker = good
        retried = await jobs.retry(job.operation_id)
        assert retried.generation == 2
        await jobs.run_job(await claim(write))
        final = await jobs.get(job.operation_id)
        assert final.status is OperationStatus.SUCCEEDED
        assert (await components.locate(BROWSER_ID)).name == f'{job.operation_id}-2'
        assert (await jobs.cancel(job.operation_id)).status is OperationStatus.SUCCEEDED
        assert (await jobs.retry(job.operation_id)).generation == 2
    with_database(tmp_path, check)


def test_cancel_during_verify_prevents_publication(tmp_path):
    async def check(write, read, _):
        components, jobs, service = setup(tmp_path, write, read)
        job = await service.accept(BROWSER_ID, 'install')
        async def worker(context, action, component_id, target):
            fake_files(components, target)
            if action == 'verify':
                await jobs.cancel(job.operation_id)
        service._worker = worker
        await jobs.run_job(await claim(write))
        assert (await jobs.get(job.operation_id)).status is OperationStatus.CANCELLED
        assert components.current(BROWSER_ID) is None
    with_database(tmp_path, check)


def test_restart_rejects_old_writer_and_keeps_identity(tmp_path):
    async def check(write, read, _):
        components, old_jobs, old = setup(tmp_path, write, read)
        accepted = await old.accept(BROWSER_ID, 'install')
        old_job = await claim(write)
        _, new_jobs, new = setup(tmp_path, write, read, 'instance-2')
        await new_jobs.recover()
        recovered = await new_jobs.get(accepted.operation_id)
        assert recovered.generation == 2 and recovered.status is OperationStatus.QUEUED
        with pytest.raises(JobSuperseded):
            await JobContext(old_jobs, old_job).check_cancel()
        async def late(context, action, component_id, target):
            fake_files(components, target)
        old._worker = late
        # 即使旧 worker 忽略安全点，发布前仍有代次检查。
        class LateContext:
            job = old_job
            async def check_cancel(self): pass
            async def progress(self, **kwargs): pass
        with pytest.raises(JobSuperseded):
            await old.process(LateContext())
        assert components.current(BROWSER_ID) is None
        new._worker = late
        await new_jobs.run_job(await claim(write, 'instance-2'))
        assert (await new_jobs.get(accepted.operation_id)).status is OperationStatus.SUCCEEDED
        assert (await components.locate(BROWSER_ID)).name.endswith('-2')
    with_database(tmp_path, check)


def test_compatible_published_version_survives_target_change(tmp_path):
    components = LocalRuntimeComponents(tmp_path)
    target = components.staging(BROWSER_ID, 'version-1')
    fake_files(components, target)
    components.publish(BROWSER_ID, 'version-1')
    assert components.current(BROWSER_ID)
    components.manifest[BROWSER_ID].version = 'next-version'
    assert components.current(BROWSER_ID)[0] == target
    assert not components.target_is_current(BROWSER_ID)
    components.manifest[BROWSER_ID].compatibility = 'incompatible-adapter'
    assert components.current(BROWSER_ID) is None


def test_upgrade_failure_cancel_restart_keep_old_until_verified_switch(tmp_path):
    async def check(write, read, _):
        components, jobs, service = setup(tmp_path, write, read)
        old = components.staging(BROWSER_ID, 'old')
        fake_files(components, old)
        components.publish(BROWSER_ID, 'old')
        next_entry = components.entry(BROWSER_ID).model_copy(update={'version': 'next', 'sha256': 'a' * 64})
        components.manifest[BROWSER_ID] = next_entry
        accepted = await service.accept(BROWSER_ID, 'upgrade')
        async def fail(context, action, component_id, target):
            fake_files(components, target)
            assert components.current(BROWSER_ID)[0] == old
            if action == 'verify':
                raise RuntimeError('failed verification')
        service._worker = fail
        await jobs.run_job(await claim(write))
        assert (await jobs.get(accepted.operation_id)).status is OperationStatus.FAILED
        assert (await service.status(BROWSER_ID)).version != 'next'
        # 仅磁盘收据即可跨服务重启读取旧版本；取消也不能抹掉它。
        reopened, new_jobs, new = setup(tmp_path, write, read)
        reopened.manifest[BROWSER_ID] = next_entry
        assert (await reopened.locate(BROWSER_ID)) == old
        await new_jobs.retry(accepted.operation_id)
        await new_jobs.cancel(accepted.operation_id)
        assert reopened.current(BROWSER_ID)[0] == old
        await new_jobs.retry(accepted.operation_id)
        async def good(context, action, component_id, target):
            fake_files(reopened, target)
            assert reopened.current(BROWSER_ID)[0] == old
        new._worker = good
        await new_jobs.run_job(await claim(write))
        assert reopened.target_is_current(BROWSER_ID)
        assert reopened.current(BROWSER_ID)[1] == 'next'
        assert old.is_dir()
    with_database(tmp_path, check)


@pytest.mark.skipif(os.getenv('RAY_TEST_COMPONENTS') != '1', reason='显式启用真实组件安装')
def test_real_ocr_install_and_browser_verify(tmp_path):
    async def check(write, read, _):
        execution_root = tempfile.mkdtemp(prefix='ra-comp-', dir='/tmp')
        executor = None
        try:
            async def executor_factory():
                nonlocal executor
                if executor is None:
                    socket = await ensure_supervisor(execution_root)
                    executor = SupervisedProcessExecutor(SupervisorClient(socket))
                return executor
            components, jobs, service = setup(tmp_path, write, read, executor_factory=executor_factory)
            accepted = await service.accept('ocr', 'real-ocr')
            await jobs.run_job(await claim(write))
            final = await jobs.get(accepted.operation_id)
            assert final.status is OperationStatus.SUCCEEDED, final.error
            assert (await components.locate('ocr') / 'rec.onnx').is_file()
            # 浏览器可从外部指定的已下载官方包预置，仍走真实冻结兼容 worker 启动和页面检查。
            from app.infrastructure.external.components.worker import unpack_zip
            archive = Path(os.environ['RAY_TEST_CHROMIUM_ARCHIVE'])
            from app.infrastructure.external.components.install_files import sha256_file
            assert sha256_file(archive) == components.entry(BROWSER_ID).sha256
            accepted = await service.accept(BROWSER_ID, 'real-browser')
            job = await claim(write)
            target = components.staging(BROWSER_ID, f'{job.operation_id}-{job.generation}')
            unpack_zip(archive, target)
            context = JobContext(jobs, job)
            await service._worker(context, 'verify', BROWSER_ID, target)
        finally:
            if executor:
                await executor.client.close()
            await stop_supervisor(execution_root)
            shutil.rmtree(execution_root)
    with_database(tmp_path, check, timeout=180)


@pytest.mark.skipif(os.getenv('RAY_TEST_COMPONENTS') != '1', reason='显式启用真实浏览器隔离与回收')
def test_deferred_browser_profiles_download_and_stop(tmp_path):
    from app.domain.external.browser_session import BrowserProfile
    from app.domain.external.process_executor import ProcessOwner
    from app.infrastructure.external.browser.local_session import DeferredBrowserSession, LocalBrowserSession
    from app.infrastructure.external.components.worker import unpack_zip
    async def check():
        execution_root = tempfile.mkdtemp(prefix='ra-browser-', dir='/tmp')
        executor = None
        sessions = []
        try:
            components = LocalRuntimeComponents(tmp_path / 'components')
            target = components.staging(BROWSER_ID, 'real')
            unpack_zip(Path(os.environ['RAY_TEST_CHROMIUM_ARCHIVE']), target)
            components.publish(BROWSER_ID, 'real')
            async def executor_factory():
                nonlocal executor
                if executor is None:
                    socket = await ensure_supervisor(execution_root)
                    executor = SupervisedProcessExecutor(SupervisorClient(socket))
                return executor
            def make(profile, run):
                session = LocalBrowserSession(components, tmp_path / 'profiles', download_dir=tmp_path / run,
                                              executor_factory=executor_factory, owner=ProcessOwner(run_id=run))
                sessions.append(session)
                return DeferredBrowserSession(session, profile)
            first = make(BrowserProfile(workspace_id='workspace-a'), 'run-1')
            await first.configure_viewports('run-1', {}, lambda records: None)
            assert executor is None and first.session._playwright is None
            result = await first.tabs()
            assert result.success
            await first.session._context.add_cookies([{'name': 'private', 'value': 'a', 'domain': 'example.test', 'path': '/', 'expires': time.time() + 3600}])
            second = make(BrowserProfile(workspace_id='workspace-b'), 'run-2')
            assert (await second.tabs()).success
            assert await second.session._context.cookies() == []
            duplicate = make(BrowserProfile(workspace_id='workspace-a'), 'run-3')
            with pytest.raises(RuntimeError, match='另一个运行'):
                await duplicate.tabs()
            page = first.session._context.pages[0]
            await page.set_content('<a download="test.txt" href="data:text/plain,downloaded">download</a>')
            async with page.expect_download() as pending:
                await page.locator('a').click()
            download = await pending.value
            assert (await download.path()).is_relative_to(tmp_path / 'run-1')
            assert (await download.path()).read_text() == 'downloaded'
            process_id = first.session._driver_process
            await first.stop()
            assert (await executor.status(process_id)).state.value != 'running'
            # 原资料目录可重新准入，同工作区保留登录态。
            again = make(BrowserProfile(workspace_id='workspace-a'), 'run-4')
            assert (await again.tabs()).success
            assert (await again.session._context.cookies())[0]['value'] == 'a'
        finally:
            for session in sessions:
                await session.stop()
            if executor:
                await executor.client.close()
            await stop_supervisor(execution_root)
            shutil.rmtree(execution_root)
    asyncio.run(asyncio.wait_for(check(), 90))


def test_restart_preserves_cancel_request(tmp_path):
    async def check(write, read, _):
        components, jobs, service = setup(tmp_path, write, read)
        accepted = await service.accept(BROWSER_ID, 'cancel-before-crash')
        await claim(write)
        await jobs.cancel(accepted.operation_id)
        _, restarted, _ = setup(tmp_path, write, read, 'instance-2')
        await restarted.recover()
        final = await restarted.get(accepted.operation_id)
        assert final.status is OperationStatus.CANCELLED and final.cancel_requested_at is not None
        assert components.current(BROWSER_ID) is None
    with_database(tmp_path, check)


@pytest.mark.skipif(os.getenv('RAY_TEST_COMPONENTS') != '1', reason='显式启用真实核心崩溃回收')
def test_core_crash_reaps_browser_driver(tmp_path):
    import json
    import subprocess
    import sys
    from app.infrastructure.external.components.worker import unpack_zip
    components = LocalRuntimeComponents(tmp_path / 'components')
    unpack_zip(Path(os.environ['RAY_TEST_CHROMIUM_ARCHIVE']), components.staging(BROWSER_ID, 'real'))
    components.publish(BROWSER_ID, 'real')
    execution_root = tempfile.mkdtemp(prefix='ra-crash-', dir='/tmp')
    code = '''
import asyncio,json,sys
from pathlib import Path
from app.infrastructure.external.browser.local_session import LocalBrowserSession
from app.infrastructure.external.components.local_components import LocalRuntimeComponents
from app.infrastructure.external.execution.supervisor_lifecycle import ensure_supervisor
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.domain.external.process_executor import ProcessOwner
from app.domain.external.browser_session import BrowserProfile
async def main():
    sock = await ensure_supervisor(sys.argv[1])
    executor = SupervisedProcessExecutor(SupervisorClient(sock))
    async def factory(): return executor
    session = LocalBrowserSession(LocalRuntimeComponents(Path(sys.argv[2])), Path(sys.argv[3]),
                                  executor_factory=factory, owner=ProcessOwner(run_id='crash-run'))
    await session.start(BrowserProfile(workspace_id='crash-workspace'))
    print(json.dumps({'driver_pid':session._playwright._impl_obj._connection._transport._proc.pid}),flush=True)
    await asyncio.Event().wait()
asyncio.run(main())
'''
    proc = subprocess.Popen([sys.executable, '-c', code, execution_root, str(components.root), str(tmp_path / 'profiles')],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        import select
        assert select.select([proc.stdout], [], [], 40)[0], '浏览器未就绪'
        driver_pid = json.loads(proc.stdout.readline())['driver_pid']
        rows = subprocess.check_output(['/bin/ps', '-ax', '-o', 'pid=,ppid='], text=True)
        pairs = [tuple(map(int, line.split())) for line in rows.splitlines()]
        descendants, frontier = {driver_pid}, {driver_pid}
        while frontier:
            frontier = {pid for pid, parent in pairs if parent in frontier} - descendants
            descendants |= frontier
        assert len(descendants) > 1
        proc.kill()
        proc.wait(timeout=10)
        def alive(pid):
            try: os.kill(pid, 0); return True
            except ProcessLookupError: return False
        deadline = time.monotonic() + 15
        while any(alive(pid) for pid in descendants) and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not any(alive(pid) for pid in descendants), f'遗留浏览器进程: {descendants}'
    finally:
        if proc.poll() is None:
            proc.kill(); proc.wait()
        asyncio.run(stop_supervisor(execution_root))
        shutil.rmtree(execution_root)
