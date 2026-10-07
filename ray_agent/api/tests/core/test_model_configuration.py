import asyncio
import copy
from dataclasses import replace

import pytest

from app.application.errors.exceptions import BadRequestError
from app.application.services.app_config_service import AppConfigService
from app.domain.models.app_config import AppConfig, LLMConfig, AgentConfig, MCPConfig, A2AConfig, ModelSampling
from app.domain.models.model_catalog import ReasoningChoice, deepseek_models, public_capabilities
from app.domain.services.context.budget import ContextBudget
from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository


def service():
    config = AppConfig(llm_config=LLMConfig(model_profiles={
        'deepseek-flash': ModelSampling(),
        'deepseek-v4-pro': ModelSampling(temperature=.3, context_window=100000),
    }), agent_config=AgentConfig(), mcp_config=MCPConfig(), a2a_config=A2AConfig())
    class Repo:
        def load(self): return copy.deepcopy(config)
        def save(self, new): config.__dict__.update(copy.deepcopy(new.__dict__))
    return AppConfigService(Repo())


def test_partial_model_save_preserves_other_model_and_validates_capacity():
    s = service()
    result = asyncio.run(s.update_llm_config({'model_profiles': {'deepseek-flash': {
        'temperature': .4, 'context_window': 250000, 'max_tokens': 16000}}}))
    assert result.model_profiles['deepseek-v4-pro'].context_window == 100000
    assert result.model_profiles['deepseek-flash'].context_window == 250000
    for patch in [dict(context_window=10000), dict(max_tokens=393217), dict(temperature=2.1), dict(context_window=1000001)]:
        values = dict(temperature=.7, max_tokens=8192, context_window=200000, **{})
        values.update(patch)
        with pytest.raises(BadRequestError):
            asyncio.run(s.update_llm_config({'model_profiles': {'deepseek-flash': values}}))
    assert asyncio.run(s.get_llm_config()).model_profiles['deepseek-flash'].context_window == 250000


def test_preview_is_server_budget_and_never_changes_saved_config():
    s = service()
    before = asyncio.run(s.get_llm_config()).model_dump()
    result = asyncio.run(s.preview_sampling('deepseek-flash', ModelSampling()))
    assert result['high'] == dict(context_window=200000, max_tokens=32768, limit=157232, watermark=117924)
    assert result['disabled']['max_tokens'] == 8192
    assert asyncio.run(s.get_llm_config()).model_dump() == before


def test_migration_preserves_custom_values_and_only_runs_once():
    data = {'llm_config': {'base_url':'https://api.deepseek.com', 'context_window':131072,
        'model_profiles': {'deepseek-flash': {'context_window':131072}, 'deepseek-v4-pro': {'context_window':90000}}}}
    assert FileAppConfigRepository._migrate_default_budget(data)
    assert data['llm_config']['context_window'] == 200000
    assert data['llm_config']['model_profiles']['deepseek-v4-pro']['context_window'] == 90000
    data['llm_config']['context_window'] = 131072
    assert not FileAppConfigRepository._migrate_default_budget(data)
    assert data['llm_config']['context_window'] == 131072


def test_vendor_efforts_are_data_and_new_budget_does_not_reuse_prior_usage():
    fake = replace(deepseek_models()[0], id='fixture-c', reasoning_family='fixture', choices=tuple(
        ReasoningChoice(id, 'enabled', id, 'all_turns') for id in ('low', 'medium', 'high', 'xhigh', 'ultra')))
    assert [o['id'] for o in public_capabilities(fake)['reasoning_options']] == ['low','medium','high','xhigh','ultra']
    messages = [{'role':'user','content':'hello'}]
    a = ContextBudget(200000, 32768, .05, .75)
    a.record_usage(messages, [], 9000)
    b = ContextBudget(100000, 32768, .05, .75)
    c = ContextBudget(250000, 32768, .05, .75)
    assert a.estimate(messages, []).method == 'usage'
    assert b.estimate(messages, []).method == c.estimate(messages, []).method == 'chars'
    b.record_usage(messages, [], 123)
    assert abs(b.estimate(messages, []).total - 123) <= 1  # 四部分分别取整


def test_selection_is_atomic_and_preview_is_read_only():
    from app.application.services.agent_service import AgentService
    from app.domain.models.session import Session, SessionStatus
    from app.domain.models.memory import Memory
    from app.domain.models.run import Run, RunStatus
    from types import SimpleNamespace
    stored = Session(model_id='deepseek-flash', reasoning='high', context_window=200000,
        max_tokens=8192, temperature=.7, memories={'agent':Memory(messages=[
            {'role':'system','content':'base'}, {'role':'user','content':'hello'},
            {'role':'assistant','content':'answer','reasoning_content':'thought'}])})
    writes=[]
    class Uow:
        fail=False
        async def __aenter__(self):
            self.local=stored.model_copy(deep=True)
            async def get(id): return self.local.model_copy(deep=True)
            async def memory(id,name): return self.local.memories[name].model_copy(deep=True)
            async def update_model(id,model,reasoning):
                writes.append(('model',model));self.local.model_id=model;self.local.reasoning=reasoning
            async def update_sampling(id,window,tokens,temperature):
                if self.fail: raise RuntimeError('sampling failed')
                writes.append(('sampling',window));self.local.context_window=window;self.local.max_tokens=tokens;self.local.temperature=temperature
            async def runs(id): return []
            self.session=SimpleNamespace(get_by_id=get,get_memory=memory,update_model=update_model,update_sampling=update_sampling)
            self.run=SimpleNamespace(list_by_session=runs)
            return self
        async def __aexit__(self,typ,*args):
            if typ is None: stored.__dict__.update(self.local.__dict__)
    s=AgentService.__new__(AgentService);s._uow_factory=Uow;s._uow=Uow()
    s._llm_config=LLMConfig(model_profiles={'deepseek-v4-pro':ModelSampling(context_window=90000,temperature=.2)})
    s._agent_config=AgentConfig();s._mcp_config=MCPConfig();s._a2a_config=A2AConfig();s._tool_policy=None;s._search_engine=None
    original=stored.model_dump()
    s._uow.fail=True
    with pytest.raises(RuntimeError,match='sampling failed'):
        asyncio.run(s.set_model(stored.id,'deepseek-v4-pro','high'))
    assert stored.model_dump()==original
    s._uow.fail=False
    asyncio.run(s.set_model(stored.id,'deepseek-v4-pro','high'))
    assert (stored.model_id,stored.context_window,stored.temperature)==('deepseek-v4-pro',90000,.2)
    before=stored.model_dump();count=len(writes)
    preview=asyncio.run(s.preview_context(stored.id))
    assert preview['context_window']==90000 and preview['method']=='chars'
    assert stored.model_dump()==before and len(writes)==count
    waiting=Run(session_id=stored.id,status=RunStatus.WAITING,config_snapshot={
        'model_name':'deepseek-flash','thinking':'enabled','reasoning':'high','context_window':200000,'max_tokens':32768,'temperature':.7})
    async def getrun(id): return waiting
    class ResumeUow(Uow):
        async def __aenter__(self):
            await super().__aenter__();self.run.get=getrun;return self
    s._uow=ResumeUow()
    resumed=asyncio.run(s._llm_for_run(stored,SessionStatus.WAITING,waiting.id))
    assert resumed.model_name=='deepseek-flash' and resumed.context_window==200000
    s._uow=Uow()
    asyncio.run(s.set_model(stored.id,'deepseek-flash','high'))
    assert stored.context_window==200000
