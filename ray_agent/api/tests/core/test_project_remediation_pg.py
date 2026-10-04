"""修订契约：创建重放、首发拒绝回滚、结构化冲突、同值保存与容量估算。"""
import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock
import pytest
from app.application.services.agent_service import AgentService
from app.application.services.project_memory_service import ProjectMemoryService
from app.application.services.session_service import SessionService
from app.domain.models.app_config import AgentConfig, MCPConfig, A2AConfig
from app.domain.models.run import RunMode
from app.domain.services.run_ledger import RunLedger
from app.domain.services.project_transactions import ProjectRunConflict
from tests.core.test_w11_projects_pg import projects
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
from tests.support.scripted_llm import ScriptedLLM
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')


def test_creation_replay_and_atomic_first_admission(tmp_path, monkeypatch):
    from app.application.services.title_service import TitleService
    monkeypatch.setattr(TitleService, 'auto_generate', AsyncMock())
    async def scenario(factory, engine):
        project_service = projects(factory, tmp_path)
        creation = str(uuid4())
        first, replay = await asyncio.gather(project_service.create('原项目', creation_id=creation), project_service.create('原项目', creation_id=creation))
        assert first.id == replay.id == creation
        sessions = SessionService(factory, object)
        independent = str(uuid4())
        a, b = await asyncio.gather(sessions.create_session(independent), sessions.create_session(independent))
        assert a.id == b.id == independent
        agent = AgentService.__new__(AgentService)
        agent._uow_factory, agent._uow = factory, factory()
        agent._ledger = RunLedger(factory)
        agent._project_prepare = project_service.prepare_snapshot
        agent._project_validator = project_service.validate_start
        agent._schedule_start = lambda *args: None
        ids = [str(uuid4()), str(uuid4())]
        import copy
        agents = [copy.copy(agent) for _ in ids]
        for item in agents:
            item._uow = factory()
        results = await asyncio.gather(*(item.chat(s, '分析数据', [], create_project_id=first.id) for item, s in zip(agents, ids)), return_exceptions=True)
        assert any(not isinstance(x, Exception) for x in results), [repr(x) for x in results]
        accepted = next(x for x in results if not isinstance(x, Exception))
        assert sum(isinstance(x, ProjectRunConflict) for x in results) == 1
        async with factory() as uow:
            page, count = await uow.session.page(project_id=first.id)
            assert count == 1
            sid = page[0].id
            assert len(await uow.run.list_by_session(sid)) == 1
            assert len(await uow.event.list(sid, types=['message'])) == 1
        again = await agent.chat(sid, '分析数据', [], create_project_id=first.id)
        assert again == accepted
        async with factory() as uow:
            assert len(await uow.event.list(sid, types=['message'])) == 1
    with_db(scenario)


def test_noop_notes_metrics_and_capacity_snapshot(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        p = await service.create('记忆估算', '字' * 8000)
        memory = ProjectMemoryService(factory, RunLedger(factory), generate=lambda _: asyncio.sleep(0, result=dict(text='实际结论', model='test-model', usage=None)))
        assert (await memory.update_notes(p.id, '', 0))['notes_version'] == 0
        await memory.update_notes(p.id, '笔' * 8000, 0)
        assert (await memory.update_notes(p.id, '笔' * 8000, 1))['notes_version'] == 1
        session = await service.create_session(p.id)
        await memory.generate_ticket(await memory.begin_summary(session.id))
        history = await service.memory_history(p.id)
        entry = next(e for e in history if e['type'] == 'conversation_summary')
        assert entry['payload']['auxiliary']['model'] == 'test-model'
        assert entry['payload']['auxiliary']['usage'] is None
        assert entry['payload']['auxiliary']['duration_ms'] >= 0
        agent = AgentService.__new__(AgentService)
        agent._uow_factory, agent._llm = factory, ScriptedLLM([], context_window=1024, max_tokens=256)
        agent._agent_config, agent._mcp_config, agent._a2a_config = AgentConfig(), MCPConfig(), A2AConfig()
        agent._search_engine, agent._tool_policy = None, None
        view = await service.memory_view(p.id, session.id)
        estimated = await agent.estimate_project_memory(view, RunMode.PLAN)
        assert estimated['project_prompt'] == view['project_prompt']
        assert estimated['capacity']['over_limit']
        assert estimated['capacity']['tool_count'] > 10
        assert estimated['capacity']['mode'] == 'plan'
    with_db(scenario)
