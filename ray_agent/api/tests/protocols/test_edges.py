import asyncio
import json
import time
from copy import deepcopy
from unittest.mock import Mock

import pytest

from app.domain.models.app_config import MCPConfig, MCPServerConfig, A2AConfig, A2AServerConfig, AppConfig
from app.application.services.app_config_service import AppConfigService
from app.infrastructure.protocols.mcp import MCPClientManager, tool_name
from app.infrastructure.protocols.a2a import A2AClientManager
from app.infrastructure.protocols.common import describe_content


@pytest.mark.anyio
async def test_mcp_wire_pagination_names_errors_and_version(servers):
    def config(scenario):
        return MCPServerConfig(url=servers['a2a']+'/mcp-wire/'+scenario, call_timeout=2)
    manager=MCPClientManager(MCPConfig(mcpServers={
        'a':config('pages'), 'a_b':config('pages'), 'a.b':config('pages'),
        'loop':config('cursor_loop'), 'legacy':config('legacy'),
        'rpc':config('rpc_error'), 'invalid':config('invalid')}))
    try:
        await manager.initialize()
        assert set(manager.errors)=={'loop','legacy'},manager.errors
        assert len(manager.tools['a'])==2
        schemas=await manager.get_all_tools()
        assert len({t['function']['name'] for t in schemas})==len(schemas)
        for server in ['a','a_b','a.b']:
            for name in ['first','second']:
                result=await manager.invoke(tool_name(server,name),{})
                assert result.success and result.data['content'][0]['text']==name
        assert (await manager.invoke(tool_name('rpc','first'),{})).data['error_kind']=='protocol_error'
        assert (await manager.invoke(tool_name('invalid','first'),{})).data['error_kind']=='invalid_response'
        wire=[json.loads(line) for line in servers['log'].read_text().splitlines() if 'mcp-wire' in line]
        assert wire and all(e['version']=='2026-07-28' for e in wire)
        assert all(e['method']!='initialize' for e in wire)
    finally:
        await manager.cleanup()


@pytest.mark.anyio
async def test_discovery_budget_and_disabled_do_not_probe(servers):
    before=servers['log'].read_text()
    for manager in [MCPClientManager(MCPConfig(mcpServers={'disabled':MCPServerConfig(
        url=servers['a2a']+'/mcp-wire/slow',enabled=False)})),
        A2AClientManager(A2AConfig(a2a_servers=[A2AServerConfig(id='disabled',base_url=servers['a2a'],enabled=False)]))]:
        await manager.initialize()
        await manager.cleanup()
    assert servers['log'].read_text()==before
    managers=[MCPClientManager(MCPConfig(discovery_budget=.2,mcpServers={str(i):MCPServerConfig(
        url=servers['a2a']+'/mcp-wire/slow') for i in range(3)})),
        A2AClientManager(A2AConfig(discovery_budget=.2,a2a_servers=[A2AServerConfig(id=str(i),base_url=servers['a2a']+'/slow') for i in range(3)]))]
    for manager in managers:
        start=time.monotonic()
        await manager.initialize()
        assert len(manager.errors)==3
        assert time.monotonic()-start < 2
        await manager.cleanup()


@pytest.mark.anyio
async def test_a2a_card_sdk_negotiation_and_invalid_interfaces(servers):
    configs=[A2AServerConfig(id=name,base_url=servers['a2a']+'/'+name) for name in ['legacy','invalid','grpc','extension']]
    manager=A2AClientManager(A2AConfig(a2a_servers=configs))
    try:
        await manager.initialize()
        # 旧卡片转换由官方 resolver 完成；产品不再自行拒绝或维护转换函数。
        assert 'legacy' in manager.agent_cards
        assert manager.agent_cards['legacy'].supported_interfaces[0].protocol_version=='0.3.0'
        assert set(manager.errors)=={'invalid','grpc','extension'}
    finally:
        await manager.cleanup()


@pytest.mark.anyio
async def test_config_offline_manageable_and_correct_return_type(servers):
    config=AppConfig.model_validate({'llm_config':{},'agent_config':{},'mcp_config':{},'a2a_config':{
        'a2a_servers':[{'id':'offline','base_url':servers['a2a']+'/invalid'},
                       {'id':'disabled','base_url':servers['a2a'], 'enabled':False}]}})
    repository=Mock()
    repository.load.side_effect=lambda:deepcopy(config)
    repository.save.side_effect=lambda value:config.__dict__.update(deepcopy(value.__dict__))
    service=AppConfigService(repository)
    rows=await service.get_a2a_servers()
    assert [(r.id,r.connection_status) for r in rows]==[('offline','unavailable'),('disabled','disabled')]
    assert isinstance(await service.set_a2a_server_enabled('offline',False),A2AConfig)
    assert isinstance(await service.delete_a2a_server('offline'),A2AConfig)
    assert [r.id for r in (await service.get_a2a_servers())]==['disabled']


def test_nontext_content_is_bounded_and_falsy_preserved():
    value=describe_content({'content':[{'type':'image','data':'x'*90000,'mime_type':'image/png'}],
                            'parts':[{'raw':'Y'*90000}], 'zero':0, 'empty':[], 'false':False})
    assert value['content'][0]['data']=={'omitted':True,'encoded_length':90000}
    assert value['parts'][0]['raw']=={'omitted':True,'encoded_length':90000}
    assert value['zero']==0 and value['empty']==[] and value['false'] is False


@pytest.mark.anyio
async def test_a2a_three_cleanup_cycles(servers):
    manager=A2AClientManager(A2AConfig(a2a_servers=[A2AServerConfig(id='test',base_url=servers['a2a'])]))
    baseline={t for t in asyncio.all_tasks() if not t.done()}
    for _ in range(3):
        await manager.initialize()
        clients=list(manager.http_clients.values())
        task=asyncio.create_task(manager.invoke('test','long'))
        await asyncio.sleep(.1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await manager.cleanup()
        await manager.cleanup()
        assert all(c.is_closed for c in clients)
        assert {t for t in asyncio.all_tasks() if not t.done()}<=baseline
