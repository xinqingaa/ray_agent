"""P5 状态转换：真实 SQLite、后台任务与 Agent 循环；模型输出可控，不连接模型服务。"""
import asyncio
import json
import sqlite3
from uuid import uuid4

import pytest

from app.application.errors.exceptions import ConflictError
from app.application.services.background_jobs import BackgroundJobRunner
from app.application.services.memory_extractor import ExtractionUnavailable, LLMMemoryExtractor, ProposedFact
from app.application.services.memory_jobs import enqueue_post_run_jobs, memory_extraction_handler, session_summary_handler
from app.application.services.workspace_service import WorkspaceService
from app.domain.models.operation import OperationKind, OperationStatus
from app.domain.models.run import RunStatus
from app.domain.models.session_summary_record import SessionSummaryRecord
from app.domain.models.workspace_memory import ExtractionCommitStatus, MemoryCertainty, MemoryOrigin, MemoryStatus, MemoryType
from app.domain.services.memory_rules import ExtractionAction, ExtractionDecision, parse_decisions
from app.domain.services.request_rebuild import rebuild_request
from tests.support.loop_harness import input_task, make_loop, make_runner, start_run
from tests.support.memory_env import JobStub, MemEnv
from tests.support.scripted_llm import text, tool_call
from tests.support.sqlite_db import factories, open_database, with_database


def scenario(tmp_path, body):
    async def run(uf, rf, db):
        await body(MemEnv(uf, rf))
    with_database(tmp_path, run, timeout=60)


async def claim(env, ws, session, seq):
    async with env.uow_factory() as uow:
        return await env.memory.claim_extraction_in(uow, ws.id, session.id, seq, str(uuid4()))


async def jobs(env, session):
    async with env.uow_factory() as uow:
        return {j.kind: j for j in await enqueue_post_run_jobs(uow, env.memory, session.id)}


async def auto(env, ws, session, content):
    job = await claim(env, ws, session, await env.say(session.id, content))
    result = await env.memory.commit_extraction(job.id, [ExtractionDecision(action='add', content=content)])
    return await env.memory.get(ws.id, result.created[0])


@pytest.mark.parametrize('change', ['edit', 'retract', 'competing_candidate', 'legacy'])
def test_candidate_checks_target_basis_and_explicit_review(tmp_path, change):
    async def body(env):
        ws = await env.workspace()
        session = await env.session(ws.id)
        target = await env.memory.create(ws.id, '发布在周五')
        job = await claim(env, ws, session, await env.say(session.id, '改到周三'))
        result = await env.memory.commit_extraction(job.id, [ExtractionDecision(
            action='update', content='发布在周三', target_id=target.id, target_version=target.version)])
        candidate = await env.memory.get(ws.id, result.candidates[0])
        assert candidate.supersedes_version == target.version
        if change == 'edit':
            target = await env.memory.edit(ws.id, target.id, target.version, content='最新决定周一发布')
        elif change == 'retract':
            target = await env.memory.retract(ws.id, target.id, target.version)
        elif change == 'competing_candidate':
            j2 = await claim(env, ws, session, await env.say(session.id, '改到周二'))
            r2 = await env.memory.commit_extraction(j2.id, [ExtractionDecision(
                action='update', content='发布在周二', target_id=target.id, target_version=target.version)])
            await env.memory.confirm(ws.id, r2.candidates[0], 1)
        else:
            async with env.uow_factory() as uow:
                await uow.memory.save(candidate.model_copy(update={'supersedes_version': None}))
        with pytest.raises(ConflictError, match='重新审阅'):
            await env.memory.confirm(ws.id, candidate.id, candidate.version)
        assert (await env.memory.get(ws.id, candidate.id)).status is MemoryStatus.CANDIDATE
        if change == 'edit':
            with pytest.raises(ConflictError):
                await env.memory.confirm(ws.id, candidate.id, candidate.version, target_version=1)
            confirmed = await env.memory.confirm(ws.id, candidate.id, candidate.version, target_version=target.version)
            assert confirmed.supersedes_version == target.version
            assert (await env.memory.get(ws.id, target.id)).status is MemoryStatus.SUPERSEDED
            with pytest.raises(ConflictError, match='不能单条撤销'):
                await env.memory.undo(ws.id, confirmed.id, confirmed.version)
    scenario(tmp_path, body)


def test_updates_and_dedup_retain_versioned_sources_and_retraction_suppresses_them(tmp_path):
    async def body(env):
        ws = await env.workspace()
        a, b, c = [await env.session(ws.id) for _ in range(3)]
        target = await auto(env, ws, a, '使用 Python 3.8')
        seq = await env.say(b.id, '使用 Python 3.12')
        update = await claim(env, ws, b, seq)
        result = await env.memory.commit_extraction(update.id, [ExtractionDecision(
            action='update', content='使用 Python 3.12', target_id=target.id, target_version=target.version)])
        assert result.updated == [target.id]
        current = await env.memory.get(ws.id, target.id)
        duplicate = await claim(env, ws, c, await env.say(c.id, current.content))
        assert (await env.memory.commit_extraction(duplicate.id, [ExtractionDecision(
            action='add', content=current.content)])).skipped == 1
        sources = await env.memory.sources(ws.id, target.id)
        assert {(s.session_id, s.memory_version) for s in sources} == {(a.id, 1), (b.id, 2), (c.id, 2)}
        assert all(s.content_fingerprint for s in sources)
        await env.memory.retract(ws.id, target.id)
        retry = await claim(env, ws, b, seq)
        assert (await env.memory.commit_extraction(retry.id, [ExtractionDecision(
            action='add', content=current.content)])).created == []
        async with env.uow_factory() as uow:
            await uow.session.delete_by_id(b.id)
        assert not next(s for s in await env.memory.sources(ws.id, target.id) if s.session_id == b.id).available
    scenario(tmp_path, body)


def test_explicit_dedup_keeps_sources_without_downgrading_user_confirmation(tmp_path):
    async def body(env):
        ws = await env.workspace()
        a, b = await env.session(ws.id), await env.session(ws.id)
        target = await auto(env, ws, a, '月报周一发送')
        seq = await env.say(b.id, '记住月报周一发送')
        upgraded = await env.memory.create(ws.id, target.content, origin=MemoryOrigin.AGENT_REQUESTED, session_id=b.id)
        confirmed = await env.memory.create(ws.id, target.content)
        assert confirmed.certainty is MemoryCertainty.USER_CONFIRMED and confirmed.version == upgraded.version + 1
        reused = await env.memory.create(ws.id, target.content, origin=MemoryOrigin.AGENT_REQUESTED, session_id=b.id)
        await env.memory.create(ws.id, target.content, origin=MemoryOrigin.AGENT_REQUESTED, session_id=b.id)
        assert reused.version == confirmed.version and reused.certainty is MemoryCertainty.USER_CONFIRMED
        sources = await env.memory.sources(ws.id, target.id)
        assert {(s.session_id, s.event_seq_end, s.memory_version) for s in sources} == {
            (a.id, 1, 1), (b.id, seq, 2), (b.id, seq, 3)}
    scenario(tmp_path, body)


def test_undo_restores_complete_state_and_creation_undo_suppresses_source(tmp_path):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        target = await auto(env, ws, s, '使用 Python')
        edited = await env.memory.edit(ws.id, target.id, target.version, content='使用 Rust', memory_type='constraint')
        assert edited.certainty is MemoryCertainty.USER_CONFIRMED
        restored = await env.memory.undo(ws.id, target.id, edited.version)
        assert (restored.content, restored.memory_type, restored.certainty) == (
            target.content, MemoryType.FACT, MemoryCertainty.MODEL_INFERRED)
        pinned = await env.memory.set_pinned(ws.id, target.id, restored.version, True)
        retracted = await env.memory.retract(ws.id, target.id, pinned.version)
        restored = await env.memory.undo(ws.id, target.id, retracted.version)
        assert restored.pinned and restored.status is MemoryStatus.ACTIVE
        created = await auto(env, ws, s, '单独的一条长期记忆')
        await env.memory.undo(ws.id, created.id, created.version)
        retry = await claim(env, ws, s, 2)
        assert not (await env.memory.commit_extraction(retry.id, [ExtractionDecision(
            action='add', content=created.content)])).created
    scenario(tmp_path, body)


def test_legacy_database_preserves_unknown_basis_and_refuses_lossy_undo(tmp_path):
    from alembic import command
    from app.infrastructure.storage.sqlite import _alembic_config, migrate
    path = tmp_path / 'rayagent.db'
    command.upgrade(_alembic_config(path), '0007_semantic_index')
    with sqlite3.connect(path) as connection:
        connection.execute("INSERT INTO memory_entries "
            "(id,workspace_id,content,memory_type,origin,certainty,status,pinned,version,created_at,updated_at) "
            "VALUES ('legacy','w','旧正文','fact','user','user_confirmed','active',1,2,"
            "'2026-01-01','2026-01-01')")
        connection.execute("INSERT INTO memory_changes "
            "(id,memory_id,workspace_id,from_version,to_version,action,origin,rationale,before_content,after_content,created_at) "
            "VALUES ('old-change','legacy','w',1,2,'update','user','','更旧正文','旧正文','2026-01-01')")
    assert migrate(path) == '0008_memory_consistency'
    with sqlite3.connect(path) as connection:
        assert connection.execute('SELECT content,pinned,supersedes_version FROM memory_entries').fetchone() == ('旧正文', 1, None)
        assert connection.execute('SELECT before_state,after_state FROM memory_changes').fetchone() == (None, None)
    async def body(env):
        from app.domain.models.workspace import Workspace
        async with env.uow_factory() as uow:
            await uow.workspace.add(Workspace(id='w', name='旧工作区'))
        with pytest.raises(ConflictError, match='旧变更缺少完整状态'):
            await env.memory.undo('w', 'legacy', 2)
        entry = await env.memory.get('w', 'legacy')
        assert entry.content == '旧正文' and entry.pinned and entry.version == 2
        edited = await env.memory.edit('w', 'legacy', 2, content='新正文', memory_type='constraint')
        restored = await env.memory.undo('w', 'legacy', edited.version)
        assert restored.content == '旧正文' and restored.memory_type is MemoryType.FACT and restored.pinned
    scenario(tmp_path, body)


def test_session_optout_invalidates_inflight_summary_and_extraction_after_reenable(tmp_path):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        await env.say(s.id, '稳定偏好')
        queued = await jobs(env, s)
        async def config(): return None
        async def generate(*args):
            await env.memory.set_session_participation(s.id, False)
            await env.memory.set_session_participation(s.id, True)
            return {'text': '已经失效的摘要', 'model': 'fake'}
        result = await session_summary_handler(env.uow_factory, env.retrieval, config, generate)(JobStub(
            queued[OperationKind.SESSION_SUMMARY]))
        assert result['status'] == 'rejected'
        assert await env.retrieval.search(ws.id, '已经失效的摘要') == []
        extraction = await env.memory.extraction_for_operation(queued[OperationKind.MEMORY_EXTRACTION].operation_id)
        assert extraction.commit_status is ExtractionCommitStatus.REJECTED
        assert not (await env.memory.commit_extraction(extraction.id, [ExtractionDecision(
            action='add', content='旧任务不能复活')])).created
    scenario(tmp_path, body)


def test_background_validation_error_stops_before_next_model_request(tmp_path):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        await env.memory.create(ws.id, '待核对背景')
        h = make_loop([tool_call('echo', {'text': '继续'}, id='one'), text('不应调用')],
                      session=s, uow_factory=env.uow_factory)
        started = await start_run(h, input_task(), '继续')
        h.loop.project_prompt = (await env.assembly.assemble(s, started.id)).project_prompt
        broken = False
        async def refresh(run_id):
            if broken:
                raise OSError('存储暂时不可读')
            return await env.runtime.refresh(run_id)
        async def hook(_):
            nonlocal broken
            broken = True
        h.recording.hook = hook
        runner = make_runner(h, run=started)
        runner._context_refresh = refresh
        await runner.invoke(input_task())
        assert len(h.llm.requests) == 1
        async with env.read_factory() as uow:
            assert (await uow.run.get(started.id)).status is RunStatus.FAILED
    scenario(tmp_path, body)


def test_cutoff_material_is_rebuilt_from_persistent_database_before_windowing(tmp_path):
    async def run():
        db = await open_database(tmp_path)
        env = MemEnv(*factories(db))
        try:
            ws = await env.workspace()
            s = await env.session(ws.id)
            await env.say(s.id, '项目背景')
            await env.say(s.id, '长期决定：使用 Rust')
            queued = (await jobs(env, s))[OperationKind.MEMORY_EXTRACTION]
            for i in range(15):
                await env.say(s.id, f'截止之后的消息 {i}')
        finally:
            await db.shutdown()
        db = await open_database(tmp_path)
        env = MemEnv(*factories(db))
        seen = []
        class Extractor:
            async def propose(self, material):
                seen.append(material)
                return [ProposedFact('长期决定：使用 Rust')]
        async def factory(): return Extractor()
        try:
            result = await memory_extraction_handler(env.uow_factory, env.retrieval, env.memory, factory)(JobStub(queued))
            assert result['created'] == 1 and seen[0]['source_seq'] == 2
            assert [x['message'] for x in seen[0]['user_updates']] == ['长期决定：使用 Rust']
            assert '截止之后' not in json.dumps(seen[0], ensure_ascii=False)
            async with env.read_factory() as uow:
                assert (await uow.session.summary_material(s.id))['truncated'] is True
        finally:
            await db.shutdown()
    asyncio.run(run())


@pytest.mark.parametrize('stage', ['propose_empty', 'last_decide', 'publish_guard', 'owner_changed'])
def test_cancel_and_takeover_prevent_memory_publication(tmp_path, stage):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        await env.memory.create(ws.id, '预算上限十万元')
        await env.say(s.id, '预算上限二十万元')
        queued = (await jobs(env, s))[OperationKind.MEMORY_EXTRACTION]
        runner = BackgroundJobRunner(env.uow_factory, 'old-core', read_uow_factory=env.read_factory)
        entered, release = asyncio.Event(), asyncio.Event()
        class Extractor:
            async def propose(self, material):
                if stage == 'propose_empty':
                    entered.set()
                    await release.wait()
                    return []
                return [ProposedFact('预算上限二十万元')]
            async def decide(self, fact, similar):
                if stage != 'publish_guard':
                    entered.set()
                    await release.wait()
                return ExtractionDecision(action='add', content=fact.content)
        async def factory(): return Extractor()
        handler = memory_extraction_handler(env.uow_factory, env.retrieval, env.memory, factory)
        if stage == 'publish_guard':
            async def guarded(context):
                original = context.check_cancel
                count = 0
                async def check():
                    nonlocal count
                    await original()
                    count += 1
                    if count == 2:  # 最后的事务外检查通过之后，取消已提交
                        await runner.cancel(queued.operation_id)
                context.check_cancel = check
                return await handler(context)
            registered = guarded
        else:
            registered = handler
        runner.register(OperationKind.MEMORY_EXTRACTION, registered, requeue_on_restart=True)
        async with env.uow_factory() as uow:
            acquired = await uow.job.claim('old-core', [OperationKind.MEMORY_EXTRACTION])
        task = asyncio.create_task(runner.run_job(acquired))
        if stage != 'publish_guard':
            await asyncio.wait_for(entered.wait(), 5)
            if stage == 'owner_changed':
                async with env.uow_factory() as uow:
                    await uow.job.requeue(queued.operation_id)
                    newer = await uow.job.claim('new-core', [OperationKind.MEMORY_EXTRACTION])
                assert newer.generation > acquired.generation
            else:
                await runner.cancel(queued.operation_id)
            release.set()
        await asyncio.wait_for(task, 5)
        final = await runner.get(queued.operation_id)
        assert final.status is (OperationStatus.RUNNING if stage == 'owner_changed' else OperationStatus.CANCELLED)
        assert len(await env.memory.entries(ws.id)) == 1
        assert (await env.memory.extraction_for_operation(queued.operation_id)).commit_status is ExtractionCommitStatus.PENDING
    scenario(tmp_path, body)


@pytest.mark.parametrize('inflight', [False, True])
def test_workspace_switch_invalidates_old_jobs_even_after_reenable(tmp_path, inflight):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        await env.say(s.id, '偏好简洁答复')
        queued = (await jobs(env, s))[OperationKind.MEMORY_EXTRACTION]
        service = WorkspaceService(env.uow_factory, env.read_factory, None, None, None, 'test', '')
        runner = BackgroundJobRunner(env.uow_factory, 'core', read_uow_factory=env.read_factory)
        entered, release = asyncio.Event(), asyncio.Event()
        class Extractor:
            async def propose(self, material):
                entered.set()
                await release.wait()
                return [ProposedFact('偏好简洁答复')]
        async def factory(): return Extractor()
        runner.register(OperationKind.MEMORY_EXTRACTION,
            memory_extraction_handler(env.uow_factory, env.retrieval, env.memory, factory), requeue_on_restart=True)
        if inflight:
            async with env.uow_factory() as uow:
                acquired = await uow.job.claim('core', [OperationKind.MEMORY_EXTRACTION])
            task = asyncio.create_task(runner.run_job(acquired))
            await asyncio.wait_for(entered.wait(), 5)
        off = await service.set_auto_memory(ws.id, False, ws.version)
        await service.set_auto_memory(ws.id, True, off.workspace.version)
        if inflight:
            release.set()
            await asyncio.wait_for(task, 5)
        assert (await runner.get(queued.operation_id)).status is OperationStatus.CANCELLED
        assert (await env.memory.extraction_for_operation(queued.operation_id)).commit_status is ExtractionCommitStatus.REJECTED
        assert await env.memory.entries(ws.id) == []
        # 新任务可用，且旧开关请求不能再次使它失效。
        await env.say(s.id, '新的长期要求')
        newer = (await jobs(env, s))[OperationKind.MEMORY_EXTRACTION]
        with pytest.raises(ConflictError):
            await service.set_auto_memory(ws.id, False, ws.version)
        assert (await runner.get(newer.operation_id)).status is OperationStatus.QUEUED
    scenario(tmp_path, body)


def test_optout_invalidates_frozen_summary_and_reenable_repairs_search(tmp_path):
    async def body(env):
        ws = await env.workspace()
        a, b = await env.session(ws.id), await env.session(ws.id)
        await env.say(a.id, '季度预算')
        async with env.uow_factory() as uow:
            record = SessionSummaryRecord(session_id=a.id, workspace_id=ws.id, body='季度预算', source_seq=1)
            await uow.summary.save(record)
            await env.retrieval.index_summary(uow, record)
        before = await env.assembly.assemble(b, 'frozen', '季度预算')
        assert len(before.manifest.retrieval_hits) == 1
        await env.memory.set_session_participation(a.id, False)
        assert await env.retrieval.search(ws.id, '季度预算') == []
        await env.memory.set_session_participation(a.id, True)
        assert len(await env.retrieval.search(ws.id, '季度预算')) == 1
        assert await env.assembly.refresh_frozen('frozen') == ''  # 重新打开也不复活旧冻结引用
        assert (await env.assembly.manifest('frozen')).omissions[-1].kind == 'revision'
        # 即使索引单独丢失，up_to_date 分支也能恢复，而无需重复调用模型。
        async with env.uow_factory() as uow:
            await env.retrieval.remove_summary(uow, ws.id, a.id)
        async def no_call(*args): raise AssertionError('无需重新生成')
        queued = (await jobs(env, a))[OperationKind.SESSION_SUMMARY]
        result = await session_summary_handler(env.uow_factory, env.retrieval, no_call, no_call)(JobStub(queued))
        assert result['reason'] == 'up_to_date' and len(await env.retrieval.search(ws.id, '季度预算')) == 1
    scenario(tmp_path, body)


def test_active_revoke_updates_model_input_and_keeps_earlier_requests_rebuildable(tmp_path):
    async def body(env):
        ws = await env.workspace()
        s = await env.session(ws.id)
        await env.style.publish(ws.id, '以当前要求为准')
        memory = await env.memory.create(ws.id, '撤回标记 AUDIT_REVOKED')
        h = make_loop([tool_call('echo', {'text': '继续'}, id='one'), text('完成')],
                      session=s, uow_factory=env.uow_factory)
        started = await start_run(h, input_task(), '继续')
        assembled = await env.assembly.assemble(s, started.id)
        h.loop.project_prompt = assembled.project_prompt
        async def revoke(_):
            await env.memory.retract(ws.id, memory.id)
            await env.memory.create(ws.id, '新增内容不能进入冻结背景')
            await env.style.publish(ws.id, '新版工作方式不能进入冻结背景')
        h.recording.hook = revoke
        runner = make_runner(h, run=started)
        runner._context_refresh = env.runtime.refresh
        await runner.invoke(input_task())
        assert len(h.llm.requests) == 2
        assert 'AUDIT_REVOKED' in h.llm.requests[0].messages[0]['content']
        assert 'AUDIT_REVOKED' not in h.llm.requests[1].messages[0]['content']
        assert '不能进入冻结背景' not in h.llm.requests[1].messages[0]['content']
        async with env.read_factory() as uow:
            run = await uow.run.get(started.id)
            events = await uow.event.list(s.id)
        assert run.status is RunStatus.COMPLETED
        for index in (1, 2):
            assert rebuild_request(events, run, index).messages == h.llm.requests[index - 1].messages
        assert len(run.config_snapshot['context_revisions']) == 1
    scenario(tmp_path, body)


@pytest.mark.parametrize('content', ['GPU[0]', '带有 "]" 和转义 \\" 的正文', '嵌套括号 [a[b]] 与 {c}'])
def test_valid_decision_json_preserves_string_content(content):
    class Extractor(LLMMemoryExtractor):
        async def _ask(self, system, payload):
            return json.dumps({'action': 'update', 'target_id': 'm', 'content': content, 'memory_type': 'fact'})
    decision = asyncio.run(Extractor(None).decide(ProposedFact(content), [{'id': 'm', 'version': 3}]))
    assert decision.action is ExtractionAction.UPDATE and decision.content == content and decision.target_version == 3
    assert parse_decisions('说明\n```json\n' + json.dumps({'items': []}) + '\n```') == []


@pytest.mark.parametrize('output', ['[]', '{"action":"unknown"}', '[1]', 'not json',
                                   '{"action":"update","target_id":"foreign"}'])
def test_invalid_decision_fails_instead_of_claiming_no_change(output):
    class Extractor(LLMMemoryExtractor):
        async def _ask(self, system, payload): return output
    with pytest.raises(ExtractionUnavailable):
        asyncio.run(Extractor(None).decide(ProposedFact('x'), [{'id': 'm', 'version': 1}]))
