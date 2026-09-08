import asyncio
import json
import os
import sys
import time
from importlib.metadata import version
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.models.app_config import MCPConfig, MCPServerConfig, A2AConfig, A2AServerConfig
from app.infrastructure.protocols.mcp import MCPClientManager, tool_name
from app.infrastructure.protocols.a2a import A2AClientManager
from app.domain.models.event import ToolEvent, ProtocolToolContent
from app.domain.models.tool_result import ToolResult
from app.interfaces.schemas.event import ToolSSEEvent

FIXTURE = Path(__file__).with_name('fixture_server.py')


def mcp_config(servers, **kwargs):
    return MCPConfig(mcpServers={'test': MCPServerConfig(url=servers['mcp']+'/mcp', **kwargs)})


def a2a_config(servers, **kwargs):
    return A2AConfig(a2a_servers=[A2AServerConfig(id='test', base_url=servers['a2a'], **kwargs)])


def events(servers):
    return [json.loads(line) for line in servers['log'].read_text().splitlines()]


def test_protocol_versions_are_locked():
    assert version('mcp') == '2.2.0'
    assert version('a2a-sdk') == '1.1.2'


@pytest.mark.parametrize('field,value', [('env',None),('args',None),('headers',None),('transport','sse'),('env',{'X':3})])
def test_mcp_rejects_invalid_configuration(field, value):
    with pytest.raises(ValidationError):
        MCPServerConfig.model_validate({'transport':'stdio','command':'python',field:value})


def test_names_and_defaults():
    assert MCPServerConfig(transport='stdio', command='python').env == {}
    assert MCPServerConfig(transport='stdio', command='python').args == []
    assert tool_name('a', 'b_c') != tool_name('a_b', 'c')
    assert tool_name('a.b', 'c') != tool_name('a_b', 'c')
    assert len(tool_name('长名字'*100, 'b')) <= 64


@pytest.mark.anyio
async def test_mcp_http_results_and_disabled(servers):
    manager = MCPClientManager(mcp_config(servers))
    try:
        await manager.initialize()
        assert not manager.errors, manager.errors
        result = await manager.invoke(tool_name('test','add'), {'a':17, 'b':25})
        assert result.success and result.data['structured_content']['result'] == 42
        result = await manager.invoke(tool_name('test','fail'), {})
        assert not result.success and 'MCP_EXPECTED_FAILURE' in result.message
        result = await manager.invoke(tool_name('test','values'), {})
        assert result.success and result.data['structured_content'] == {'zero':0,'false':False,'empty':'','list':[]}
        assert result.data['content'][0]['text'] == ''
        assert not (await manager.invoke('mcp_test_unknown',{})).success
    finally:
        await manager.cleanup()
    disabled = MCPClientManager(mcp_config(servers, enabled=False))
    await disabled.initialize()
    assert disabled.connections == {} and disabled.tools == {}
    await disabled.cleanup()


@pytest.mark.anyio
async def test_mcp_stdio_partial_failure_reinitialize_and_cancel(tmp_path):
    log = tmp_path/'stdio.jsonl'
    good = MCPServerConfig(transport='stdio',command=sys.executable,
        args=[str(FIXTURE),'mcp','--transport','stdio'], env={'RAY_PROTOCOL_LOG':str(log)})
    manager = MCPClientManager(MCPConfig(mcpServers={
        'good': good, 'broken': MCPServerConfig(transport='stdio', command='/missing/rayagent-test-command')}))
    baseline = {t for t in asyncio.all_tasks() if not t.done()}
    for _ in range(3):
        await manager.initialize()
        assert 'good' in manager.tools and 'broken' in manager.errors, manager.errors
        pending = asyncio.create_task(manager.invoke(tool_name('good','delay'), {'seconds':30}))
        await asyncio.sleep(.15)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        await manager.cleanup()
        await manager.cleanup()
        await asyncio.sleep(.05)
        for row in map(json.loads, log.read_text().splitlines()):
            with pytest.raises(ProcessLookupError):
                os.kill(row['pid'], 0)
        assert {t for t in asyncio.all_tasks() if not t.done()} <= baseline


@pytest.mark.anyio
async def test_mcp_timeout(servers):
    manager=MCPClientManager(mcp_config(servers,call_timeout=2))
    try:
        await manager.initialize()
        start=time.monotonic()
        result=await manager.invoke(tool_name('test','delay'),{'seconds':30})
        assert not result.success and result.data['error_kind']=='timeout'
        assert time.monotonic()-start < 3
    finally:
        await manager.cleanup()


@pytest.mark.anyio
async def test_a2a_message_task_and_states(servers):
    manager=A2AClientManager(a2a_config(servers))
    try:
        await manager.initialize()
        assert not manager.errors, manager.errors
        result=await manager.invoke('test','ray-agent-a2a-check')
        assert result.success and result.data['message']['parts'][0]['text']=='A2A_OK:ray-agent-a2a-check'
        before=len([e for e in events(servers) if e['method']=='SendMessage'])
        result=await manager.invoke('test','delay')
        assert result.success and result.data['remote_state']=='completed'
        assert result.data['task']['artifacts'][0]['parts'][0]['text']=='A2A_ARTIFACT_OK'
        assert len([e for e in events(servers) if e['method']=='SendMessage'])==before+1
        for state in ['fail','rejected','canceled','input_required','auth_required','completed']:
            result=await manager.invoke('test',state)
            assert result.success == (state=='completed')
            assert result.data['remote_state']==('failed' if state=='fail' else state)
        for query,kind in [('rpc_error','protocol_error'),('invalid','invalid_response')]:
            result=await manager.invoke('test',query)
            assert not result.success and result.data['error_kind']==kind, result
    finally:
        await manager.cleanup()
    assert not manager.clients and not manager.http_clients


@pytest.mark.anyio
async def test_a2a_timeout_and_cancel(servers):
    manager=A2AClientManager(a2a_config(servers, call_timeout=2, cancel_timeout=.2))
    try:
        await manager.initialize()
        start=time.monotonic()
        result=await manager.invoke('test','long')
        assert time.monotonic()-start<3
        assert not result.success and result.data['error_kind']=='timeout' and result.data['task_id']
        for query,expected in [('long','canceled'),('cancel_rejected','rejected'),('cancel_timeout','timeout'),('slow_message','no_task_id')]:
            pending=asyncio.create_task(manager.invoke('test',query))
            await asyncio.sleep(.2)
            start=time.monotonic();pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert time.monotonic()-start<1
            assert manager.last_cancellations['test']['remote_cancel']==expected
    finally:
        await manager.cleanup()


@pytest.mark.parametrize('value',[0,False,'',[],{},None])
def test_event_roundtrip(value):
    event=ToolEvent(tool_call_id='call',tool_name='mcp',function_name='test',function_args={},status='called',
                    function_result=ToolResult(success=False,message='reason',data=value),
                    tool_content=ProtocolToolContent(outcome=ToolResult(success=False,message='reason',data=value)))
    replay=ToolEvent.model_validate_json(event.model_dump_json())
    outcome=ToolSSEEvent.from_event(replay).model_dump(mode='json')['data']['content']['outcome']
    assert outcome == {'success':False,'message':'reason','data':value}
