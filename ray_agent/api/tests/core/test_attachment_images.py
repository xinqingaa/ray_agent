"""真实图片编码、附件受理、循环输入和请求重建；存储/沙箱/模型使用替身。"""
import asyncio
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from app.application.errors.exceptions import BadRequestError
from app.application.services.attachment_images import prepare_attachment_images
from app.domain.models.event import MessageEvent
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.run import Run
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.context.compaction import user_origins, match_events
from app.domain.services.context.vision import image_refs, reconcile_visual_history
from app.domain.services.request_rebuild import rebuild_request
from app.infrastructure.external.file_storage.image_input import encode_image, MAX_SOURCE_BYTES
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.domain.models.app_config import LLMConfig
from tests.support.loop_harness import make_loop, input_task, start_run, make_runner
from tests.support.scripted_llm import text, tool_call
from tests.core.test_task_execution_control import make_service


def png(size=(320, 180), color=(255, 0, 0, 128)):
    output = io.BytesIO()
    Image.new('RGBA', size, color).save(output, format='PNG')
    return output.getvalue()


def storage(body, file):
    return SimpleNamespace(download_file=AsyncMock(side_effect=lambda _: (io.BytesIO(body), file)))


def execute(coro):
    return asyncio.run(asyncio.wait_for(coro, 10))


def test_image_encoding_is_bounded_deterministic_and_preserves_original():
    body = png((4200, 2400))
    encoded, spec = encode_image(body)
    assert encode_image(body) == (encoded, spec)
    assert max(spec['width'], spec['height']) == 2048
    assert spec['size'] <= 2 * 1024 * 1024
    assert spec['sha256'] != spec['original_sha256']
    with Image.open(io.BytesIO(encoded)) as image:
        assert image.mode == 'RGB'
        assert image.getpixel((10, 10))[0] > 240
    assert Image.open(io.BytesIO(body)).size == (4200, 2400)
    with pytest.raises(ValueError, match='20 MiB'):
        encode_image(b'x' * (MAX_SOURCE_BYTES + 1))
    with pytest.raises(ValueError, match='无法读取'):
        encode_image(b'not a real png')
    out = io.BytesIO()
    Image.new('RGB', (20, 20)).save(out, format='BMP')
    with pytest.raises(ValueError, match='支持 PNG'):
        encode_image(out.getvalue())


def test_gif_first_frame_and_exif_orientation():
    output = io.BytesIO()
    Image.new('RGB', (40, 20), 'red').save(output, format='GIF', save_all=True,
        append_images=[Image.new('RGB', (40, 20), 'blue')])
    encoded, spec = encode_image(output.getvalue())
    assert spec['frames'] == 2
    assert Image.open(io.BytesIO(encoded)).getpixel((0, 0))[0] > 240
    output = io.BytesIO()
    original = Image.new('RGB', (40, 20))
    exif = original.getexif(); exif[274] = 6
    original.save(output, format='JPEG', exif=exif)
    _, spec = encode_image(output.getvalue())
    assert (spec['width'], spec['height']) == (20, 40)


def test_preflight_selects_pixels_or_file_tools_automatically():
    async def scenario():
        file = File(id='f', filename='image.png', extension='.png', mime_type='image/png')
        store = storage(png(), file)
        event = MessageEvent(role='user', message='看图', attachments=[file])
        assert await prepare_attachment_images(store, event, 's', False) == []
        assert event.image_mode == 'auto' and '未提供图片像素' in event.image_input_note
        store.download_file.assert_not_awaited()
        event.image_mode = 'files'
        assert await prepare_attachment_images(store, event, 's', False) == []
        event.image_mode = 'auto'; event.attachments = [file] * 3
        assert await prepare_attachment_images(store, event, 's', True) == []
        assert '数量超过' in event.image_input_note
        event.attachments = [file]
        refs = await prepare_attachment_images(store, event, 's', True)
        assert refs[0]['source'] == 'user_attachment'
        assert refs[0]['session_id'] == 's'
        assert 'base64' not in str(refs)
        assert event.image_input_note is None
        assert await prepare_attachment_images(storage(b'broken', file), event, 's', True) == []
        assert '未生成像素' in event.image_input_note
        missing = SimpleNamespace(download_file=AsyncMock(side_effect=OSError('unavailable')))
        with pytest.raises(BadRequestError, match='读取失败'):
            await prepare_attachment_images(missing, event, 's', True)
    execute(scenario())


def test_pixels_reach_adapter_and_context_rebuild_with_owned_reference():
    async def scenario():
        body = png()
        file = File(id='f', filename='image.png', extension='.png', mime_type='image/png', filepath='/home/ubuntu/upload/image.png')
        event = MessageEvent(role='user', message='分析红色区域', attachments=[file])
        event.image_inputs = await prepare_attachment_images(storage(body, file), event, 's', True)
        message = AgentTaskRunner._to_message(event)
        h = make_loop([text('红色区域')])
        h.llm.supports_vision = True
        events = [e async for e in h.loop.invoke(message)]
        request = h.llm.requests[0].messages
        assert list(image_refs(request))[0]['file_id'] == 'f'
        origins = user_origins(request[1:])
        match_events(origins, [(1, event.message)])
        assert origins[0].event_seq == 1
        assert '/home/ubuntu/upload/image.png' in origins[0].content
        for index, item in enumerate(events, 1):
            item.seq = index; item.run_id = 'r'
        rebuilt = rebuild_request(events, Run(id='r', session_id='s', config_snapshot={'system_prompt':request[0]['content']}), 1)
        assert rebuilt.messages == request
        assert rebuilt.images == event.image_inputs
        runner = AgentTaskRunner.__new__(AgentTaskRunner)
        runner._session_id = 's'; runner._file_storage = storage(body, file)
        llm = OpenAILLM(LLMConfig(api_key='test', base_url='https://api.deepseek.com', model_name='deepseek-flash'))
        llm.image_loader = runner._load_visual_image
        encoded = await llm._materialize_images(request)
        assert encoded[-1]['content'][-1]['image_url']['url'].startswith('data:image/jpeg;base64,')
        assert request[-1]['content'][-1]['type'] == 'image_ref'
        runner._file_storage = storage(png(color=(0, 255, 0, 255)), file)
        with pytest.raises(ValueError, match='已变化'):
            await runner._load_visual_image(event.image_inputs[0])
        with pytest.raises(ValueError, match='不属于'):
            await runner._load_visual_image({**event.image_inputs[0], 'session_id':'other'})
        await llm._client.close()
    execute(scenario())


def test_waiting_reply_and_running_injection_include_user_images():
    async def scenario():
        ref = dict(encode_image(png())[1], source='user_attachment', file_id='f', session_id='s', purpose='用户图片', temporary=False)
        h = make_loop([tool_call('message_ask_user', {'text':'请补图'}), text('已看图')])
        h.llm.supports_vision = True
        _ = [e async for e in h.loop.invoke(Message(message='先提问'))]
        _ = [e async for e in h.loop.invoke(Message(message='这是图片', images=[ref]), prior_status=h.session.status)]
        assert list(image_refs(h.llm.requests[-1].messages)) == [ref]
        h = make_loop([text('已看图')]); h.llm.supports_vision = True
        drain = AsyncMock(side_effect=[[Message(message='补充图片', images=[ref])], []])
        _ = [e async for e in h.loop.invoke(Message(message='开始'), drain_injected_messages=drain)]
        assert list(image_refs(h.llm.requests[0].messages)) == [ref]
        fresh = [{'role':'user','content':[{'type':'image_ref','image_ref':{**ref,'file_id':str(i)}} for i in range(3)]}]
        with pytest.raises(ValueError, match='未静默丢弃'):
            reconcile_visual_history(fresh, True)
        assert not list(image_refs(reconcile_visual_history(fresh, False)))
    execute(scenario())


def test_chat_uses_active_model_capability_and_persists_files_choice():
    async def scenario():
        h = make_loop([text('done')]); h.llm.supports_vision = True
        file = File(id='f', filename='image.png', extension='.png', mime_type='image/png')
        service = make_service(h)
        service._llm = h.llm; service._file_storage = storage(png(), file)
        service._uow.file.get_by_id = AsyncMock(return_value=file)
        task = input_task(); task.done = False
        run = await start_run(h, task, '开始')
        h.runs[run.id].config_snapshot = {'vision':False, 'model_name':'frozen-model'}
        task.task_runner = SimpleNamespace(run_id=run.id)
        service._get_task = AsyncMock(return_value=task)
        before = len(h.events)
        accepted = await service.chat(h.session.id, '看图', attachments=['f'])
        assert accepted.route == 'injected' and len(h.events) == before + 1
        stored = h.events[-1]
        assert stored.image_mode == 'auto' and stored.image_inputs == []
        assert '未提供图片像素' in stored.image_input_note
        accepted = await service.chat(h.session.id, '作为材料', attachments=['f'], image_mode='files')
        assert accepted.route == 'injected'
        stored = h.events[-1]
        assert stored.image_mode == 'files' and stored.image_inputs == []
        h.runs[run.id].config_snapshot['vision'] = True
        accepted = await service.chat(h.session.id, '看图', attachments=['f'])
        assert h.events[-1].image_inputs[0]['file_id'] == 'f'
    execute(scenario())


def test_same_named_images_get_distinct_sandbox_paths():
    async def scenario():
        h = make_loop([text('done')])
        runner = make_runner(h)
        files = {str(i): File(id=str(i), filename='clipboard.png', extension='.png') for i in range(2)}
        runner._file_storage = SimpleNamespace(download_file=AsyncMock(side_effect=lambda file_id: (io.BytesIO(png()), files[file_id])))
        runner._sandbox.upload_file = AsyncMock(return_value=SimpleNamespace(success=True))
        event = MessageEvent(role='user', message='比较两张图', attachments=list(files.values()))
        await AgentTaskRunner._sync_message_attachments_to_sandbox(runner, event)
        assert len({file.filepath for file in event.attachments}) == 2
        assert event.attachments[0].filepath.endswith('/clipboard.png')
        assert event.attachments[1].filepath.endswith('/clipboard-1.png')
    execute(scenario())
