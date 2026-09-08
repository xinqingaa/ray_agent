"""确定性协议验收服务，独立于模型和 labs；只在本地测试中运行。"""
import argparse
import asyncio
import json
import os
import time
import uuid
from pathlib import Path


def record(**event):
    event.update(time=time.time(), pid=os.getpid())
    if filename := os.environ.get('RAY_PROTOCOL_LOG'):
        with open(filename, 'a') as stream:
            stream.write(json.dumps(event) + '\n')


def mcp_server(args):
    from mcp.server import MCPServer
    from mcp import types
    from mcp.server.transport_security import TransportSecuritySettings
    server = MCPServer('RayAgent acceptance', version='1.0')

    @server.tool()
    def add(a: int, b: int) -> int:
        """验收加法：返回两个整数之和。"""
        record(protocol='mcp', method='add', a=a, b=b)
        return a + b

    @server.tool()
    def fail() -> types.CallToolResult:
        """验收错误：固定返回失败 MCP_EXPECTED_FAILURE。"""
        record(protocol='mcp', method='fail')
        return types.CallToolResult(is_error=True, content=[types.TextContent(type='text', text='MCP_EXPECTED_FAILURE')])

    @server.tool()
    def values() -> types.CallToolResult:
        """返回空字符串、false、0、空列表等有效结果。"""
        return types.CallToolResult(content=[types.TextContent(type='text', text='')],
                                   structured_content={'zero': 0, 'false': False, 'empty': '', 'list': []})

    @server.tool()
    async def delay(seconds: float = 30) -> str:
        """等待指定秒数，用于超时和取消验收。"""
        record(protocol='mcp', method='delay', seconds=seconds)
        await asyncio.sleep(seconds)
        return 'MCP_DELAY_OK'

    record(protocol='mcp', method='start')
    if args.transport == 'stdio':
        server.run()
    else:
        server.run(transport='streamable-http', host='0.0.0.0', port=args.port,
                   transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))


def a2a_server(args):
    import uvicorn
    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    from a2a.types import a2a_pb2 as t
    from google.protobuf.json_format import MessageToDict

    tasks = {}
    base = args.public_url or f'http://127.0.0.1:{args.port}'
    card = t.AgentCard(name='RayAgent 验收 Agent', description='echo 原文回复；delay 延迟完成产物；fail 固定失败。',
        version='1.0', supported_interfaces=[t.AgentInterface(url=base+'/', protocol_binding='JSONRPC', protocol_version='1.0')],
        capabilities=t.AgentCapabilities(), default_input_modes=['text/plain'], default_output_modes=['text/plain'],
        skills=[t.AgentSkill(id='acceptance', name='确定性验收', description='echo:返回 A2A_OK:原文；delay:延迟产物；fail:失败', tags=['test'])])

    async def get_card(request: Request):
        record(protocol='a2a', method='GetCard')
        return JSONResponse(MessageToDict(card))

    def make_task(id, state, reason='', artifact=False):
        task = t.Task(id=id, context_id='context-'+id, status=t.TaskStatus(state=state,
            message=t.Message(message_id=str(uuid.uuid4()), role=t.ROLE_AGENT, parts=[t.Part(text=reason)])))
        if artifact:
            task.artifacts.append(t.Artifact(artifact_id='artifact-'+id, parts=[t.Part(text='A2A_ARTIFACT_OK')]))
        return task

    async def rpc(request: Request):
        body = await request.json()
        method, params = body.get('method'), body.get('params', {})
        record(protocol='a2a', method=method, params=params, version=request.headers.get('a2a-version'))
        def result(value):
            return JSONResponse({'jsonrpc': '2.0', 'id': body['id'], 'result': MessageToDict(value)})
        def error():
            return JSONResponse({'jsonrpc': '2.0', 'id': body['id'], 'error': {'code': -32603, 'message': 'A2A_EXPECTED_RPC_ERROR'}})
        if method == 'SendMessage':
            query = ''.join(part.get('text', '') for part in params['message']['parts'])
            if query == 'rpc_error':
                return error()
            if query == 'invalid':
                return JSONResponse({'jsonrpc': '2.0', 'id': body['id'], 'result': {}})
            if query == 'slow_message':
                await asyncio.sleep(30)
            states = {'fail': t.TASK_STATE_FAILED, 'rejected': t.TASK_STATE_REJECTED,
                      'canceled': t.TASK_STATE_CANCELED, 'input_required': t.TASK_STATE_INPUT_REQUIRED,
                      'auth_required': t.TASK_STATE_AUTH_REQUIRED, 'completed': t.TASK_STATE_COMPLETED}
            if query in states:
                return result(t.SendMessageResponse(task=make_task(str(uuid.uuid4()), states[query], 'A2A_EXPECTED_'+query.upper(), query == 'completed')))
            if query in {'delay', 'long', 'cancel_rejected', 'cancel_timeout'}:
                id = str(uuid.uuid4())
                tasks[id] = (query, time.monotonic())
                return result(t.SendMessageResponse(task=make_task(id, t.TASK_STATE_WORKING)))
            text = query.removeprefix('echo:')
            return result(t.SendMessageResponse(message=t.Message(message_id=str(uuid.uuid4()), role=t.ROLE_AGENT,
                         parts=[t.Part(text='A2A_OK:'+text)])))
        if method == 'GetTask':
            id = params['id']; query, started = tasks[id]
            completed = query == 'delay' and time.monotonic() - started >= 1
            return result(make_task(id, t.TASK_STATE_COMPLETED if completed else t.TASK_STATE_WORKING, artifact=completed))
        if method == 'CancelTask':
            id = params['id']; query, _ = tasks[id]
            if query == 'cancel_rejected':
                return error()
            if query == 'cancel_timeout':
                await asyncio.sleep(30)
            return result(make_task(id, t.TASK_STATE_CANCELED))
        return error()

    async def mcp_wire(request: Request):
        body = await request.json()
        scenario = request.path_params['scenario']
        method = body['method']
        record(protocol='mcp-wire', method=method, scenario=scenario,
               version=request.headers.get('mcp-protocol-version'), params=body.get('params'))
        params = body.get('params') or {}
        value = {}
        if method == 'server/discover':
            if scenario == 'slow':
                await asyncio.sleep(30)
            if scenario == 'legacy':
                return JSONResponse({'jsonrpc':'2.0','id':body['id'],
                                     'error':{'code':-32601,'message':'Method not found'}})
            value = {'supportedVersions':['2026-07-28'], 'capabilities':{'tools':{}}}
        elif method == 'tools/list':
            page = params.get('cursor')
            name = 'first' if page is None else 'second'
            value = {'tools':[{'name':name,'inputSchema':{'type':'object','properties':{}}}]}
            if page is None or scenario == 'cursor_loop':
                value['nextCursor'] = 'page2'
        elif method == 'tools/call':
            if scenario == 'rpc_error':
                return JSONResponse({'jsonrpc':'2.0','id':body['id'],'error':{'code':-32603,'message':'expected'}})
            if scenario == 'invalid':
                value = {'content': 'illegal'}
            else:
                value = {'content':[{'type':'text','text':params['name']}], 'isError':False}
        value.update(resultType='complete')
        if method in {'tools/list', 'server/discover'}:
            value.update(cacheScope='private', ttlMs=0)
        return JSONResponse({'jsonrpc':'2.0','id':body['id'],'result':value})

    async def special_card(request: Request):
        scenario=request.path_params['scenario']
        record(protocol='a2a-card',method='GetCard',scenario=scenario)
        if scenario == 'slow':
            await asyncio.sleep(30)
        data=MessageToDict(card)
        if scenario == 'invalid':
            data={'name':'broken'}
        if scenario == 'grpc':
            data['supportedInterfaces'][0]['protocolBinding']='GRPC'
        if scenario == 'extension':
            data['capabilities']={'extensions':[{'uri':'urn:unsupported', 'required':True}]}
        if scenario == 'legacy':
            del data['supportedInterfaces']
            data['url']=base+'/'
            data['protocolVersion']='0.3.0'
        return JSONResponse(data)

    uvicorn.run(Starlette(routes=[Route('/.well-known/agent-card.json', get_card),
                Route('/{scenario}/.well-known/agent-card.json', special_card),
                Route('/mcp-wire/{scenario}', mcp_wire, methods=['POST']), Route('/', rpc, methods=['POST'])]),
                host='0.0.0.0', port=args.port, log_level='warning')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('protocol', choices=['mcp', 'a2a'])
    parser.add_argument('--transport', default='http', choices=['stdio', 'http'])
    parser.add_argument('--port', type=int, default=9911)
    parser.add_argument('--public-url')
    args = parser.parse_args()
    (mcp_server if args.protocol == 'mcp' else a2a_server)(args)
