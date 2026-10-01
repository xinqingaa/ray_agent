"""项目记忆真实 PostgreSQL：冻结、CAS、审计回滚、摘要代次/截止及材料选择。"""
import pytest
from app.application.services.project_memory_service import ProjectMemoryService, NotesConflict
from app.application.errors.exceptions import ConflictError, BadRequestError
from app.domain.models.workspace_project import ProjectSettings
from app.domain.models.event import MessageEvent, DoneEvent
from app.domain.models.run import RunStatus
from app.domain.services.run_ledger import RunLedger
from app.domain.services.prompts.project import snapshot_prompt, bounded_summaries
from tests.core.test_w11_projects_pg import projects
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立 PostgreSQL')


def test_notes_settings_and_frozen_run(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        p = await service.create('记忆项目', '原说明')
        session = await service.create_session(p.id)
        ledger = RunLedger(factory)
        memory = ProjectMemoryService(factory, ledger)
        async def prepare(uow):
            current = await uow.session.get_by_id(session.id)
            await service.prepare_snapshot(uow, current)
            session.project_snapshot = current.project_snapshot
        run = await ledger.start(session.id, before_start=prepare)
        frozen = snapshot_prompt(session.project_snapshot)
        assert '原说明' in frozen and '版本 0' in frozen
        await memory.update_notes(p.id, '用户笔记', 0)
        await service.update(p.id, ProjectSettings(name=p.name,instructions='新说明'), base_version=0)
        with pytest.raises(ConflictError):
            await service.update(p.id, ProjectSettings(name=p.name,instructions='丢失写入'), base_version=0)
        with pytest.raises(NotesConflict) as exc:
            await memory.update_notes(p.id, '过时工具', 0, session_id=session.id,run_id=run.id)
        assert exc.value.data == dict(content='用户笔记',notes_version=1)
        async with factory() as uow:
            assert not await uow.event.list(session.id,types=['project_notes'])
            assert len(await uow.project.events(p.id)) == 2
        await memory.update_notes(p.id, 'Agent结论', 1, session_id=session.id,run_id=run.id)
        async with factory() as uow:
            event = (await uow.event.list(session.id,types=['project_notes']))[0]
            audit = (await uow.project.events(p.id))[-1]
        assert event.content == audit['payload']['content'] == 'Agent结论'
        assert event.notes_version == 2 and audit['payload']['run_id'] == run.id
        assert frozen == snapshot_prompt(session.project_snapshot)
        await ledger.transition(session.id,run.id,RunStatus.WAITING)
        await memory.update_notes(p.id, '等待期间编辑', 2)
        assert frozen == snapshot_prompt(session.project_snapshot)
        await ledger.transition(session.id,run.id,RunStatus.RUNNING)
        await ledger.transition(session.id,run.id,RunStatus.COMPLETED)
        with pytest.raises(ConflictError):
            await memory.update_notes(p.id, '迟到',3,session_id=session.id,run_id=run.id)
        with pytest.raises(BadRequestError):
            await memory.update_notes(p.id,'字'*8001,3)
        async with factory() as uow:
            current = await uow.session.get_by_id(session.id)
            await service.prepare_snapshot(uow,current)
        assert '新说明' in snapshot_prompt(current.project_snapshot)
        assert '等待期间编辑' in snapshot_prompt(current.project_snapshot)
    with_db(scenario)


def test_summary_generations_sources_failures_and_stale_session_save(tmp_path):
    async def scenario(factory,engine):
        service=projects(factory,tmp_path);p=await service.create('摘要项目')
        s=await service.create_session(p.id); ledger=RunLedger(factory);memory=ProjectMemoryService(factory,ledger)
        older=await memory.begin_summary(s.id)
        newer=await memory.begin_summary(s.id)
        assert await memory.complete_summary(newer,'新摘要')
        assert not await memory.complete_summary(older,'过时摘要')
        async with factory() as uow:
            stale=await uow.session.get_by_id(s.id)
        await memory.edit_summary(s.id,'手动摘要',newer['generation'])
        assert await memory.begin_summary(s.id) is None
        assert not await memory.complete_summary(newer,'迟到结果')
        async with factory() as uow:
            discarded = [event for event in await uow.project.events(p.id) if event['type'] == 'conversation_summary_discarded']
        assert len(discarded) == 2
        assert discarded[-1]['payload']['current_source'] == 'manual'
        assert discarded[-1]['payload']['generation'] == newer['generation']
        # 正常会话状态/沙箱引用保存不会恢复旧摘要或代次。
        async with factory() as uow:
            stale.sandbox_id='old-sandbox'
            await uow.session.save(stale)
        assert (await memory.get_summary(s.id))['summary']=='手动摘要'
        ticket=await memory.begin_summary(s.id,manual=True)
        assert not await memory.complete_summary(ticket,error='请求失败')
        fields=await memory.get_summary(s.id)
        assert fields['summary']=='手动摘要' and fields['summary_state']=='failed' and fields['summary_error']=='请求失败'
        with pytest.raises(ConflictError):
            await memory.edit_summary(s.id,'过时手动编辑',newer['generation'])
        # 截止 seq 的额外检查，哪怕代次相同也拒绝回退。
        async with factory() as uow:
            await uow.project.get(p.id,lock=True)
            await uow.session.set_summary_fields(s.id,summary_source_seq=100)
        assert not await memory.complete_summary(ticket,'过时范围')
    with_db(scenario)


def test_summary_material_only_completed_final_replies_and_bounds(tmp_path):
    async def scenario(factory,engine):
        service=projects(factory,tmp_path);p=await service.create('摘要材料')
        s=await service.create_session(p.id);ledger=RunLedger(factory)
        run=await ledger.start(s.id,events_after=[MessageEvent(role='user',message='最初目标')])
        await ledger.append(s.id,[MessageEvent(role='assistant',message='中间回复'),MessageEvent(role='assistant',message='最终结论')],run_id=run.id)
        await ledger.transition(s.id,run.id,RunStatus.COMPLETED,events_before=[DoneEvent()])
        async with factory() as uow:
            project=await uow.project.get(p.id,lock=True);project.file_operation=None;await uow.project.save(project)
        failed=await ledger.start(s.id,events_after=[MessageEvent(role='user',message='后续目标')])
        await ledger.append(s.id,[MessageEvent(role='assistant',message='不能当成完成的结果')],run_id=failed.id)
        await ledger.transition(s.id,failed.id,RunStatus.FAILED)
        async with factory() as uow:
            material=await uow.session.summary_material(s.id)
        assert material['first_user']=='最初目标'
        assert [f['message'] for f in material['finals']]==['最终结论']
        assert material['source_seq']==material['finals'][0]['seq']
        for index in range(12):
            other=await service.create_session(p.id)
            async with factory() as uow:
                await uow.project.get(p.id,lock=True)
                await uow.session.set_summary_fields(other.id,summary='摘'*300,summary_source='auto',summary_source_seq=index)
        async with factory() as uow:
            recent=await uow.session.recent_summaries(p.id,s.id)
            snapshot=await service.memory_snapshot(uow,s)
        assert len(recent)==10 and all(i['session_id']!=s.id for i in recent)
        assert sum(len(i['injected_text']) for i in snapshot.summaries)<=1500
        assert all('source_seq' in i for i in snapshot.summaries)
    with_db(scenario)


def test_notes_audit_failure_rolls_back_all_writes_and_restart_invalidates_summary(tmp_path, monkeypatch):
    async def scenario(factory,engine):
        from app.infrastructure.repositories.db_project_repository import DBProjectRepository
        service=projects(factory,tmp_path);p=await service.create('原子性')
        session=await service.create_session(p.id);ledger=RunLedger(factory);memory=ProjectMemoryService(factory,ledger)
        run=await ledger.start(session.id)
        original=DBProjectRepository.audit
        async def fail(*args,**kwargs):
            raise RuntimeError('模拟审计插入失败')
        monkeypatch.setattr(DBProjectRepository,'audit',fail)
        with pytest.raises(RuntimeError):
            await memory.update_notes(p.id,'不应留下',0,session_id=session.id,run_id=run.id)
        with pytest.raises(RuntimeError):
            await service.update(p.id,ProjectSettings(name=p.name,instructions='不应留下说明'),base_version=0)
        monkeypatch.setattr(DBProjectRepository,'audit',original)
        async with factory() as uow:
            project=await uow.project.get(p.id)
            assert project.notes=='' and project.notes_version==project.settings_version==0 and project.instructions is None
            assert not await uow.project.events(p.id)
            assert not await uow.event.list(session.id,types=['project_notes'])
        ticket=await memory.begin_summary(session.id)
        await memory.reconcile_startup()
        state=await memory.get_summary(session.id)
        assert state['summary_state']=='failed' and '重启' in state['summary_error']
        assert not await memory.complete_summary(ticket,'重启前迟到')
    with_db(scenario)


def test_chat_receipt_freezes_full_context_and_waiting_reuses_same_run(tmp_path):
    async def scenario(factory,engine):
        from unittest.mock import AsyncMock, Mock
        from app.application.services.agent_service import AgentService
        service=projects(factory,tmp_path);p=await service.create('受理冻结','第一说明')
        session=await service.create_session(p.id);ledger=RunLedger(factory);memory=ProjectMemoryService(factory,ledger)
        async with factory() as uow:
            await uow.session.set_title(session.id,'冻结测试','manual')
        agent=AgentService.__new__(AgentService)
        agent._uow_factory,agent._uow,agent._ledger=factory,factory(),ledger
        agent._project_prepare=service.prepare_snapshot
        agent._project_validator=service.validate_start
        agent._get_task=AsyncMock(return_value=None)
        agent._schedule_start=Mock()
        accepted=await agent.chat(session.id,'第一运行')
        async with factory() as uow:
            first=await uow.run.get(accepted.run_id)
        assert first.config_snapshot['project_context']['notes_version']==0
        assert '第一说明' in first.config_snapshot['project_prompt']
        await service.update(p.id,ProjectSettings(name=p.name,instructions='第二说明'),base_version=0)
        await memory.update_notes(p.id,'第二笔记',0)
        await ledger.transition(session.id,first.id,RunStatus.WAITING)
        resumed=await agent.chat(session.id,'等待后的回答')
        assert resumed.run_id==first.id and resumed.route=='resumed'
        async with factory() as uow:
            waiting=await uow.run.get(first.id)
        assert waiting.config_snapshot==first.config_snapshot
        await ledger.transition(session.id,first.id,RunStatus.COMPLETED)
        async with factory() as uow:
            project=await uow.project.get(p.id,lock=True);project.file_operation=None;await uow.project.save(project)
        newer=await agent.chat(session.id,'新运行')
        async with factory() as uow:
            second=await uow.run.get(newer.run_id)
        assert newer.run_id!=first.id
        assert second.config_snapshot['project_context']['notes_version']==1
        assert '第二说明' in second.config_snapshot['project_prompt'] and '第二笔记' in second.config_snapshot['project_prompt']
    with_db(scenario)


def test_project_navigation_reports_waiting_and_terminal_status(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('侧栏状态')
        session = await service.create_session(project.id)
        ledger = RunLedger(factory)
        run = await ledger.start(session.id)
        async def check(status, reason=None):
            views, total = await service.page()
            detail = await service.detail(project.id)
            assert total == 1 and views[0].task_count == 1
            for view in (views[0].model_dump(), detail):
                assert view['active_run_status'] == status
                assert view['active_run_reason'] == reason
                assert view['occupying_session_id'] == (session.id if status else None)
        await check('running')
        await ledger.transition(session.id, run.id, RunStatus.WAITING, reason='approval')
        await check('waiting', 'approval')
        await ledger.transition(session.id, run.id, RunStatus.RUNNING)
        await ledger.transition(session.id, run.id, RunStatus.WAITING)
        await check('waiting')
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED)
        await check(None)
    with_db(scenario)
