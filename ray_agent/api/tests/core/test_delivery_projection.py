import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from app.domain.models.file import File
from app.domain.models.event import ToolEvent, ToolEventStatus, DoneEvent
from app.domain.models.tool_result import ToolResult
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.flows.agent_loop import AgentLoop
from app.domain.services.tools.deliver import DeliveredFile, DeliveryItem, DeliveryResult


def test_call_id_reaches_delivery_and_partial_card_message_survives_failed_tool_result():
    async def scenario():
        status={'state':'failed','copy_key':'delivery:key','error':'disk full','can_retry':True}
        file=File(id='file',filename='report.csv',project_persistence=status)
        delivery=SimpleNamespace(deliver=AsyncMock(return_value=DeliveredFile(file=file,project=status)))
        runner=AgentTaskRunner.__new__(AgentTaskRunner)
        runner._project_delivery_service=delivery;runner._project_id='project';runner._session_id='session';runner._run_id='run';runner._sandbox=object()
        runner._persist=AsyncMock();runner._handle_tool_event=AsyncMock()
        async def events():
            yield ToolEvent(status=ToolEventStatus.CALLING,tool_name='deliver',function_name='deliver_files',tool_call_id='call-123',function_args={'paths':['/tmp/report.csv']})
            delivered=await runner._deliver_file('/tmp/report.csv')
            assert delivered.file.id=='file'
            yield DoneEvent()
        await runner._drive(events())
        assert delivery.deliver.await_args.args[:5]==('project','session','run','call-123','/tmp/report.csv')
        invocation=SimpleNamespace(function_name='deliver_files',events=[])
        result=ToolResult(success=False,data=DeliveryResult(items=[DeliveryItem(path='/tmp/report.csv',success=True,file=file,project=status)],note='下载报告'))
        await AgentLoop._emit_delivery_message(None,invocation,result)
        assert len(invocation.events)==1 and invocation.events[0].attachments[0].id=='file'
        assert '交付可下载，但未保存到项目' in invocation.events[0].message
    asyncio.run(scenario())


def test_project_attachment_rename_is_used_in_sandbox_and_streams_close():
    async def scenario():
        import io
        files=[File(id='one',filename='same.txt'),File(id='two',filename='same.txt')]
        streams=[];paths=[]
        async def download(fid):
            stream=io.BytesIO(fid.encode());streams.append(stream)
            return stream,next(f for f in files if f.id==fid)
        async def sandbox_upload(**kwargs):
            paths.append((kwargs['filepath'],kwargs['file_data'].read()))
            return ToolResult(success=True)
        async def publish(pid,fid,rid):
            return SimpleNamespace(path='uploads/same.txt' if fid=='one' else 'uploads/same (1).txt')
        class Uow:
            file=SimpleNamespace(save=AsyncMock())
            session=SimpleNamespace(add_file=AsyncMock())
            async def __aenter__(self):return self
            async def __aexit__(self,*args):return False
        runner=AgentTaskRunner.__new__(AgentTaskRunner)
        runner._file_storage=SimpleNamespace(download_file=download)
        runner._sandbox=SimpleNamespace(upload_file=sandbox_upload)
        runner._project_attachment_service=SimpleNamespace(publish=publish)
        runner._project_id='project';runner._run_id='run';runner._session_id='session';runner._uow=Uow()
        from app.domain.models.event import MessageEvent
        event=MessageEvent(role='user',message='附件',attachments=files)
        await runner._sync_message_attachments_to_sandbox(event)
        assert paths==[('/home/ubuntu/upload/same.txt',b'one'),('/home/ubuntu/upload/same (1).txt',b'two')]
        assert all(s.closed for s in streams)
        assert [f.filepath for f in event.attachments]==[p for p,_ in paths]
    asyncio.run(scenario())
