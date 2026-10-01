"""真实 PG、磁盘、存储；沙箱/模型替身，实际路径由沙箱契约返回。"""
import asyncio
import io
from pathlib import Path
import pytest
from fastapi import UploadFile
from app.application.services.project_delivery_service import ProjectDeliveryService
from app.domain.models.event import MessageEvent
from app.domain.models.run import RunStatus
from app.domain.models.tool_result import ToolResult
from app.domain.services.run_ledger import RunLedger
from app.domain.services.project_file_coordinator import ProjectFileCoordinator
from app.domain.services.tools.deliver import DeliverTool
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
from tests.core.test_project_attachments_pg import services
from tests.core.test_project_snapshots_pg import Stopped
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')


class Sandbox:
    def __init__(self, resolved, data=b'delivered'):
        self.resolved, self.data, self.downloads = resolved, data, 0
    async def check_file_exists(self, path):
        return ToolResult(data={'exists':True, 'regular_file':True, 'resolved_path':self.resolved})
    async def download_file(self, path):
        assert path == self.resolved
        self.downloads += 1
        return io.BytesIO(self.data)


async def context(factory, tmp_path):
    projects, fs, uploads = services(factory, tmp_path)
    fs.delivery = ProjectDeliveryService(fs, uploads.file_storage)
    project = await projects.create('交付副本'); session = await projects.create_session(project.id)
    run = await RunLedger(factory).start(session.id, events_after=[MessageEvent(role='user',message='分析交付')])
    return projects, fs, uploads, project, session, run


@pytest.mark.parametrize('source,resolved,inside', [
    ('/workspace/report.csv','/workspace/report.csv',True),
    ('/workspace-other/report.csv','/workspace-other/report.csv',False),
    ('/workspace/link.csv','/tmp/report.csv',False),
    ('/tmp/link.csv','/workspace/report.csv',True),
])
def test_resolved_workspace_boundary_and_same_call_reuses_delivery(tmp_path, source, resolved, inside):
    async def scenario(factory, engine):
        projects, fs, uploads, project, session, run = await context(factory,tmp_path)
        sandbox = Sandbox(resolved)
        if inside:
            fs.file_io(project.id).publish('report.csv',io.BytesIO(sandbox.data))
        result = await fs.delivery.deliver(project.id,session.id,run.id,'call-1',source,sandbox)
        assert result.project['state'] == ('in_workspace' if inside else 'ready')
        assert result.file.project_persistence == result.project
        async with factory() as uow:
            copy = await uow.project.file_copy(project.id,result.project['copy_key'])
        assert copy.resolved_path == resolved and copy.source_path == source and copy.tool_call_id == 'call-1'
        again = await fs.delivery.deliver(project.id,session.id,run.id,'call-1',source,sandbox)
        assert again.file.id == result.file.id and sandbox.downloads == 1
        if not inside:
            assert copy.path == 'outputs/' + source.rsplit('/',1)[-1]
            assert (Path(fs.file_io(project.id).root)/copy.path).read_bytes() == sandbox.data
        assert len([e for e in fs.file_io(project.id).walk() if e.type=='file']) == 1
        async with factory() as uow:
            stored = await uow.session.get_by_id(session.id)
        assert len(stored.files) == 1
        if inside:
            fresh = await fs.delivery.deliver(project.id,session.id,run.id,'call-next',source,sandbox)
            assert fresh.project['state'] == 'in_workspace' and fresh.project['path'] == copy.path
            assert fresh.file.id != result.file.id
    with_db(scenario)


def test_partial_failure_has_download_card_and_retry_needs_no_sandbox_or_redelivery(tmp_path):
    async def scenario(factory,engine):
        projects, fs, uploads, project, session, run = await context(factory,tmp_path)
        sandbox = Sandbox('/tmp/report.csv',b'answer,42\n')
        original = fs.delivery._persist
        async def fail(copy):
            raise OSError('注入项目磁盘不可写')
        fs.delivery._persist = fail
        async def deliver(path):
            return await fs.delivery.deliver(project.id,session.id,run.id,'call-1',path,sandbox)
        tool = DeliverTool(deliver)
        result = await tool.invoke('deliver_files',paths=['/tmp/report.csv'])
        assert not result.success and result.data.items[0].success
        assert len(result.data.files) == 1
        assert '交付可下载，但未保存到项目' in result.message
        file = result.data.files[0];key = result.data.items[0].project['copy_key']
        data,_ = await uploads.file_storage.download_file(file.id)
        try:
            assert data.read() == b'answer,42\n'
        finally:
            data.close()
        # 运行中不从外部补存入口抢入；工具自身同 call 可补存。
        with pytest.raises(Exception,match='活动运行'):
            await fs.delivery.retry(project.id,key)
        await RunLedger(factory).transition(session.id,run.id,RunStatus.COMPLETED)
        await ProjectFileCoordinator(factory,Stopped).settle(project.id)
        fs.delivery._persist = original
        async def gone(path):
            raise FileNotFoundError('沙箱已销毁')
        sandbox.download_file = gone
        ready = await fs.delivery.retry(project.id,key)
        assert ready['state']=='ready'
        assert (Path(fs.file_io(project.id).root)/ready['path']).read_bytes() == b'answer,42\n'
        assert (await fs.delivery.retry(project.id,key)) == ready
        async with factory() as uow:
            copy=await uow.project.file_copy(project.id,key)
            stored=await uow.session.get_by_id(session.id)
        assert copy.attachment_id == file.id and len(stored.files)==1
        assert sandbox.downloads == 1
    with_db(scenario)


def test_same_name_different_calls_and_pending_result_unknown_reuses_bytes(tmp_path):
    async def scenario(factory,engine):
        projects,fs,uploads,project,session,run=await context(factory,tmp_path)
        sandbox=Sandbox('/tmp/file.txt',b'one')
        first=await fs.delivery.deliver(project.id,session.id,run.id,'call-1','/tmp/file.txt',sandbox)
        sandbox.data=b'two'
        second=await fs.delivery.deliver(project.id,session.id,run.id,'call-2','/tmp/file.txt',sandbox)
        assert second.project['path']=='outputs/file (1).txt'
        assert first.file.id != second.file.id and sandbox.downloads==2
        async with factory() as uow:
            await uow.project.get(project.id,lock=True)
            copy=await uow.project.file_copy(project.id,second.project['copy_key'])
            copy.state='pending'
            await uow.project.save_file_copy(copy)
        repeated=await fs.delivery.deliver(project.id,session.id,run.id,'call-2','/tmp/file.txt',sandbox)
        assert repeated.project['path']==second.project['path'] and sandbox.downloads==2
        assert len([e for e in fs.file_io(project.id).walk() if e.type=='file'])==2
    with_db(scenario)


def test_cancelled_copy_thread_holds_run_writer_until_actual_exit(tmp_path):
    async def scenario(factory,engine):
        import threading
        from app.domain.services.project_file_coordinator import register_writer,retire_writer
        from app.infrastructure.external.project.file_io import ProjectFileIO
        projects,fs,uploads,project,session,run=await context(factory,tmp_path)
        entered,release=threading.Event(),threading.Event()
        original=ProjectFileIO.publish
        def blocked(self,path,*args,**kwargs):
            if path.startswith('outputs/'):
                entered.set();assert release.wait(5)
            return original(self,path,*args,**kwargs)
        ProjectFileIO.publish=blocked
        token=register_writer(project.id)
        sandbox=Sandbox('/tmp/report.txt')
        worker=asyncio.create_task(fs.delivery.deliver(project.id,session.id,run.id,'call-stop','/tmp/report.txt',sandbox))
        try:
            assert await asyncio.to_thread(entered.wait,5)
            await RunLedger(factory).transition(session.id,run.id,RunStatus.CANCELLED)
            worker.cancel();await asyncio.sleep(0)
            assert not worker.done()
            assert not await ProjectFileCoordinator(factory,Stopped).settle(project.id)
            release.set()
            with pytest.raises(asyncio.CancelledError):await worker
            async with factory() as uow:
                copy=await uow.project.file_copy(project.id,fs.delivery.key(run.id,'call-stop','/tmp/report.txt'))
            assert copy.state=='ready'
            assert (Path(fs.file_io(project.id).root)/copy.path).read_bytes()==sandbox.data
            retire_writer(project.id,token)
            assert await ProjectFileCoordinator(factory,Stopped,fs.measure_size).settle(project.id)
        finally:
            release.set();ProjectFileIO.publish=original;retire_writer(project.id,token)
            if not worker.done():
                worker.cancel()
                try:await worker
                except asyncio.CancelledError:pass
    with_db(scenario)
