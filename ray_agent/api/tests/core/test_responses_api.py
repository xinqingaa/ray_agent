"""真实 OpenAI SDK + HTTP 替身；无公网、数据库或真实工具副作用。"""
import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI

from app.domain.external.llm import LLMRequestError
from app.domain.models.app_config import LLMConfig
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.event import AttemptEvent, AttemptReason
from app.domain.services.flows.agent_loop import normalize_assistant_message
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.llm.responses import response_input, response_result
from tests.support.loop_harness import make_loop, memory_messages


def output(text='完成', *, calls=False, provider='openai'):
    reasoning = {'type': 'reasoning', 'id': 'rs', 'summary': []}
    if provider == 'deepseek': reasoning['content'] = [{'type': 'reasoning_text', 'text': '想过'}]
    else: reasoning['encrypted_content'] = 'opaque-state'
    items = [reasoning]
    if calls: items += [{'type': 'function_call', 'id': 'fc', 'call_id': 'call_a', 'name': 'echo', 'arguments': '{"text":"hi"}', 'status': 'completed'}]
    else: items += [{'type': 'message', 'id': 'msg', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}]
    return {'id': 'resp', 'object': 'response', 'created_at': 1, 'status': 'completed', 'model': 'fixture', 'output': items,
            'usage': {'input_tokens': 20, 'output_tokens': 5, 'total_tokens': 25,
                      'input_tokens_details': {'cached_tokens': 10}, 'output_tokens_details': {'reasoning_tokens': 2}}}


def sse(events):
    return ''.join(f'event: {event["type"]}\ndata: {json.dumps(event)}\n\n' for event in events)


def setup(replies, *, model='gpt-6.1-sol', streaming=True, thinking='enabled', effort='high'):
    calls = []
    def handler(request):
        calls.append((request.url.path, json.loads(request.content)))
        status, body = replies.pop(0)
        return httpx.Response(status, json=body) if isinstance(body, dict) else httpx.Response(status, text=body, headers={'content-type': 'text/event-stream'})
    llm = OpenAILLM(LLMConfig(api_key='fixture', base_url='https://fixture.test/v1', model_name=model, streaming=streaming),
                    thinking=thinking, reasoning_effort=effort, keep_reasoning=False)
    llm._client = AsyncOpenAI(api_key='fixture', base_url='https://fixture.test/v1', max_retries=0,
                              http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return llm, calls


@pytest.mark.parametrize('provider,model', [('openai','gpt-6.1-sol'), ('deepseek','deepseek-flash')])
def test_semantic_stream_round_trip_and_vendor_reasoning(provider, model):
    async def case():
        whole = output(calls=True, provider=provider)
        events = [{'type':'response.output_text.delta','delta':'先检查','item_id':'msg','output_index':0,'content_index':0},
                  {'type':'response.function_call_arguments.delta','delta':'{"text":','item_id':'fc','output_index':1},
                  {'type':'response.completed','response':whole}]
        llm,calls = setup([(200,sse(events)),(200,sse([{'type':'response.completed','response':output(provider=provider)}]))], model=model)
        seen=[]
        async def delta(text): seen.append(text)
        result=await llm.invoke([{'role':'system','content':'系统'},{'role':'user','content':'任务'}],
                              tools=[{'type':'function','function':{'name':'echo','parameters':{'type':'object'}}}], on_delta=delta)
        normalized=normalize_assistant_message(result.message)
        history=[{'role':'user','content':'任务'},normalized,{'role':'tool','tool_call_id':'call_a','content':'结果'}]
        final=await llm.invoke(history)
        assert final.message['content']=='完成' and result.finish_reason=='tool_calls'
        assert seen==['先检查'] and result.ttft_ms is not None
        assert (result.usage.prompt_tokens,result.usage.cached_tokens,result.usage.reasoning_tokens)==(20,10,2)
        path,request=calls[0]
        assert path=='/v1/responses' and request['reasoning']=={'effort':'high'}
        assert request['max_output_tokens']==8192 and 'temperature' not in request
        assert request['tools'][0]['strict'] is False and 'function' not in request['tools'][0]
        replay=calls[1][1]['input']
        assert replay[1]==whole['output'][0] and replay[2]==whole['output'][1]
        assert replay[-1]=={'type':'function_call_output','call_id':'call_a','output':'结果'}
        assert ('include' in request)==(provider=='openai')
        if provider=='openai': assert request['store'] is False
        memory=Memory(messages=history);memory.strip_reasoning()
        assert all(item['type']!='reasoning' for item in normalized['_ray_responses']['items'])
        await llm._client.close()
    asyncio.run(case())


def test_nonstream_image_history_conversion_and_cross_model_isolation():
    async def case():
        llm,calls=setup([(200,output(provider='deepseek'))],model='deepseek-flash',streaming=False,thinking='disabled',effort=None)
        old=normalize_assistant_message(response_result(output(calls=True),'gpt-6.1-sol','openai').message)
        await llm.invoke([{'role':'user','content':[{'type':'text','text':'图片'},{'type':'image_url','image_url':{'url':'data:image/png;base64,aA==','detail':'high'}}]},old,
                          {'role':'tool','tool_call_id':'call_a','content':'结果'}],response_format={'type':'json_schema','json_schema':{'name':'result','schema':{'type':'object'}}})
        sent=calls[0][1]
        assert sent['reasoning']=={'effort':'none'} and sent['temperature']==.7
        assert sent['input'][0]['content'][1]['image_url']=='data:image/png;base64,aA=='
        assert not any(item['type']=='reasoning' for item in sent['input'] if 'type' in item)
        assert sent['text']['format']['name']=='result' and 'json_schema' not in sent['text']['format']
        assert sent['input'][1]['type']=='function_call'
        await llm._client.close()
    asyncio.run(case())


@pytest.mark.parametrize('code,message,retryable', [
    ('bad_response','Upstream response stream was interrupted',True),
    ('bad_response','The service is temporarily unavailable. Please retry later.',True),
    ('bad_response','Invalid upstream protocol',False),
    ('invalid_api_key','invalid key',False),
    ('insufficient_quota','quota exceeded',False),
    ('server_error','busy',True),
    ('context_length_exceeded','too long',False),
])
@pytest.mark.parametrize('terminal', ['error','response.failed'])
def test_structured_error_classification(code,message,retryable,terminal):
    async def case():
        event={'type':'error','code':code,'message':message} if terminal=='error' else {
            'type':'response.failed','response':{**output(),'status':'failed','error':{'code':code,'message':message}}}
        llm,_=setup([(200,sse([event]))])
        try:
            with pytest.raises(LLMRequestError) as caught: await llm.invoke([{'role':'user','content':'任务'}])
            assert caught.value.retryable is retryable
            assert caught.value.context_exceeded == (code=='context_length_exceeded')
        finally: await llm._client.close()
    asyncio.run(case())


def test_real_sdk_interrupted_stream_retries_in_loop_without_executing_partial_call():
    async def case():
        broken=sse([{'type':'response.function_call_arguments.delta','delta':'{"text":','item_id':'fc','output_index':0},
                    {'type':'error','code':'bad_response','message':'Upstream response stream was interrupted'}])
        llm,calls=setup([(200,broken),(200,sse([{'type':'response.completed','response':output()}]))])
        h=make_loop([],max_retries=2);h.loop._llm=llm
        events=[event async for event in h.loop.invoke(Message(message='任务'))]
        assert len(calls)==2 and h.recording.calls==[]
        attempt=next(event for event in events if isinstance(event,AttemptEvent))
        assert attempt.reason==AttemptReason.STREAM_INTERRUPTED and attempt.retried
        assert [m['content'] for m in memory_messages(h.session) if m['role']=='assistant']==['完成']
        assert (await h.loop.config_snapshot())['api_protocol']=='responses'
        await llm._client.close()
    asyncio.run(case())


class PeerClosed(httpx.AsyncByteStream):
    """先送出部分 SSE，再像中转站那样在分块传输中途断开连接。"""
    def __init__(self, head): self.head = head
    async def __aiter__(self):
        yield self.head.encode()
        raise httpx.RemoteProtocolError('peer closed connection without sending complete message body (incomplete chunked read)')


def chat_sse(text):
    chunk = {'id':'c','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':{'content':text},'finish_reason':None}]}
    return f'data: {json.dumps(chunk)}\n\n'


@pytest.mark.parametrize('protocol', ['responses','chat_completions'])
def test_peer_closed_mid_stream_is_retryable_on_both_protocols(protocol):
    async def case():
        head = chat_sse('部分') if protocol == 'chat_completions' else sse(
            [{'type':'response.output_text.delta','delta':'部分','item_id':'msg','output_index':0,'content_index':0}])
        def handler(request):
            return httpx.Response(200, headers={'content-type':'text/event-stream'}, stream=PeerClosed(head))
        llm = OpenAILLM(LLMConfig(api_key='fixture', base_url='https://fixture.test/v1', model_name='gpt-6.1-sol', api_protocol=protocol),
                        reasoning_effort='high')
        llm._client = AsyncOpenAI(api_key='fixture', base_url='https://fixture.test/v1', max_retries=0,
                                  http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        seen = []
        async def delta(text): seen.append(text)
        try:
            with pytest.raises(LLMRequestError) as caught: await llm.invoke([{'role':'user','content':'任务'}], on_delta=delta)
            assert caught.value.retryable and caught.value.reason == 'stream_interrupted'
            assert seen == ['部分']
        finally: await llm._client.close()
    asyncio.run(case())


def test_peer_closed_mid_stream_retries_in_loop_and_keeps_only_complete_reply():
    async def case():
        replies = [PeerClosed(sse([{'type':'response.output_text.delta','delta':'部分','item_id':'msg','output_index':0,'content_index':0}])),
                   sse([{'type':'response.completed','response':output()}])]
        def handler(request):
            body = replies.pop(0)
            if isinstance(body, str): return httpx.Response(200, text=body, headers={'content-type':'text/event-stream'})
            return httpx.Response(200, headers={'content-type':'text/event-stream'}, stream=body)
        llm = OpenAILLM(LLMConfig(api_key='fixture', base_url='https://fixture.test/v1', model_name='gpt-6.1-sol'), reasoning_effort='high')
        llm._client = AsyncOpenAI(api_key='fixture', base_url='https://fixture.test/v1', max_retries=0,
                                  http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        h = make_loop([], max_retries=2); h.loop._llm = llm
        events = [event async for event in h.loop.invoke(Message(message='任务'))]
        attempt = next(event for event in events if isinstance(event, AttemptEvent))
        assert attempt.reason == AttemptReason.STREAM_INTERRUPTED and attempt.retried and attempt.chars == 2
        assert replies == []
        assert [m['content'] for m in memory_messages(h.session) if m['role']=='assistant'] == ['完成']
        await llm._client.close()
    asyncio.run(case())


def connect_failing_llm(failures):
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if len(calls) <= failures:
            raise httpx.ConnectError('[Errno -2] Name or service not known', request=request)
        return httpx.Response(200, text=sse([{'type':'response.completed','response':output()}]), headers={'content-type':'text/event-stream'})
    llm = OpenAILLM(LLMConfig(api_key='fixture', base_url='https://fixture.test/v1', model_name='gpt-6.1-sol'), reasoning_effort='high')
    llm._client = AsyncOpenAI(api_key='fixture', base_url='https://fixture.test/v1', max_retries=0,
                              http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return llm, calls


def test_connect_failure_is_flagged_and_logs_underlying_cause():
    from app.infrastructure.external.llm.openai_llm import _cause_chain
    async def case():
        llm, _ = connect_failing_llm(1)
        try:
            with pytest.raises(LLMRequestError) as caught: await llm.invoke([{'role':'user','content':'任务'}])
            assert caught.value.retryable and caught.value.connect_failed and caught.value.reason == 'transport'
            assert _cause_chain(caught.value.__cause__).startswith('ConnectError: [Errno -2] Name or service not known')
        finally: await llm._client.close()
    asyncio.run(case())


@pytest.mark.parametrize('failures,completed', [(4, True), (6, False)])
def test_connect_failures_back_off_without_spending_max_retries(failures, completed):
    async def case():
        llm, calls = connect_failing_llm(failures)
        h = make_loop([], max_retries=2); h.loop._llm = llm
        events = [event async for event in h.loop.invoke(Message(message='任务'))]
        attempts = [event for event in events if isinstance(event, AttemptEvent)]
        assert all(event.reason == AttemptReason.TRANSPORT and event.chars == 0 for event in attempts)
        if completed:
            assert len(calls) == 5 and all(event.retried for event in attempts)
            assert [m['content'] for m in memory_messages(h.session) if m['role']=='assistant'] == ['完成']
        else:
            assert len(calls) == 6 and [event.retried for event in attempts] == [True] * 5 + [False]
        await llm._client.close()
    asyncio.run(case())


def test_model_clients_share_one_long_lived_pool_per_event_loop():
    async def build():
        first = OpenAILLM(LLMConfig(api_key='fixture', model_name='gpt-6.1-sol'))
        second = OpenAILLM(LLMConfig(api_key='fixture', model_name='deepseek-flash'))
        return first._client._client, second._client._client
    a, b = asyncio.run(build())
    c, _ = asyncio.run(build())
    assert a is b and a is not c
    assert a._transport._pool._keepalive_expiry == 30


@pytest.mark.parametrize('ended', [False,True])
def test_truncated_or_missing_terminal_never_becomes_complete(ended):
    async def case():
        incomplete={**output(calls=True),'status':'incomplete','incomplete_details':{'reason':'max_output_tokens'}}
        event={'type':'response.incomplete','response':incomplete} if ended else {'type':'response.function_call_arguments.delta','delta':'{"','item_id':'fc','output_index':0}
        llm,_=setup([(200,sse([event]))])
        try:
            if ended:
                result=await llm.invoke([{'role':'user','content':'任务'}]);assert result.finish_reason=='length'
            else:
                with pytest.raises(LLMRequestError,match='完整终态') as caught:await llm.invoke([{'role':'user','content':'任务'}])
                assert caught.value.retryable
        finally:await llm._client.close()
    asyncio.run(case())


def test_gpt_factory_parameters_do_not_need_deepseek_thinking_toggle():
    llm=OpenAILLM(LLMConfig(model_name='gpt-6.1-sol',api_key='fixture'),reasoning_effort='high',thinking=None,keep_reasoning=False)
    kwargs=llm._responses_kwargs([{'role':'user','content':'任务'}],None,None,None)
    assert 'temperature' not in kwargs and llm.keep_reasoning
    assert kwargs['reasoning']=={'effort':'high'}


def test_content_filter_and_unfinished_tool_items_are_not_executable():
    for raw in [{**output(calls=True),'status':'incomplete','incomplete_details':{'reason':'content_filter'}},
                {**output(calls=True),'output':[{'type':'function_call','call_id':'a','name':'echo','arguments':'{','status':'in_progress'}]}]:
        with pytest.raises(LLMRequestError):response_result(raw,'gpt-6.1-sol','openai')


def test_http_quota_is_not_retried_and_legacy_stream_bad_response_is():
    from openai import APIError, RateLimitError
    from app.infrastructure.external.llm.openai_llm import _is_transport_error
    request=httpx.Request('POST','https://fixture.test/responses')
    quota=RateLimitError('quota',response=httpx.Response(429,request=request),body={'code':'insufficient_quota'})
    assert not _is_transport_error(quota)
    assert _is_transport_error(APIError('Upstream response stream was interrupted',request=request,body={'code':'bad_response'}))


def test_sdk_tool_executes_once_and_restored_memory_replays_opaque_reasoning():
    async def case():
        llm,calls=setup([(200,sse([{'type':'response.completed','response':output(calls=True)}])),
                         (200,sse([{'type':'response.completed','response':output()}])),
                         (200,sse([{'type':'response.completed','response':output('后续完成')}]))])
        h=make_loop([]);h.loop._llm=llm
        _=[event async for event in h.loop.invoke(Message(message='任务'))]
        assert len(h.recording.calls)==1
        stored=Memory.model_validate_json(Memory(messages=memory_messages(h.session)).model_dump_json())
        h.session.memories['agent']=stored
        resumed=make_loop([],session=h.session);resumed.loop._llm=llm
        _=[event async for event in resumed.loop.invoke(Message(message='继续核对'))]
        assert resumed.recording.calls==[]
        assert any(item.get('encrypted_content')=='opaque-state' for item in calls[-1][1]['input'])
        assert len([item for item in calls[1][1]['input'] if item.get('type')=='function_call_output'])==1
        await llm._client.close()
    asyncio.run(case())


def test_embedded_call_normalization_preserves_paired_response_input():
    raw=output(json.dumps({'type':'tool_use','name':'echo','id':'embedded','input':{'text':'hi'}}))
    message=normalize_assistant_message(response_result(raw,'gpt-6.1-sol','openai').message)
    items=response_input([message,{'role':'tool','tool_call_id':'embedded','content':'hi'}],'gpt-6.1-sol','openai')
    assert items[-2]['type']=='function_call' and items[-2]['call_id']==items[-1]['call_id']=='embedded'
    assert items[0]['encrypted_content']=='opaque-state'


def test_terminal_tail_is_drained_but_never_blocks_or_retries_complete_result():
    from types import SimpleNamespace
    class Tail:
        def __init__(self,hang):self.hang=hang;self.reads=0;self.closed=False
        def __aiter__(self):return self
        async def __anext__(self):
            self.reads+=1
            if self.reads==1:return {'type':'response.completed','response':output()}
            if self.hang:await asyncio.sleep(10)
            raise StopAsyncIteration
        async def close(self):self.closed=True
    async def case():
        for hang in [False,True]:
            tail=Tail(hang)
            llm=OpenAILLM(LLMConfig(api_key='fixture',model_name='gpt-6.1-sol'),reasoning_effort='high')
            async def create(**kwargs):return tail
            llm._client=SimpleNamespace(responses=SimpleNamespace(create=create))
            result=await asyncio.wait_for(llm.invoke([{'role':'user','content':'任务'}]),2)
            assert result.finish_reason=='stop' and tail.reads==2 and tail.closed
    asyncio.run(case())
