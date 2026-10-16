import asyncio
import io
import json
import stat
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from core.config import Settings
from app.domain.models.message import Message, SkillSelection
from app.domain.models.event import ApprovalEvent, ErrorEvent
from app.domain.models.app_config import ToolPolicyConfig
from app.domain.models.run import RunMode
from app.domain.services.skill_packages import SkillError, prepare_local, unzip, candidates, parse_skill
from app.application.services.skill_service import SkillService
from app.application.services.skill_runtime import SkillRuntime
from app.infrastructure.external.skills.storage import SkillStorage
from app.infrastructure.external.skills.github import GitHubSkills
from app.domain.services.tools.skill import SkillTool
from app.domain.services.flows.tool_pipeline import ToolPipeline
from app.domain.services.context.compaction import user_origins
from tests.support.skill_repository import MemorySkills
from tests.support.loop_harness import make_loop, memory_messages
from tests.support.scripted_llm import text, tool_call


def source(name='example', body='执行可复用方法。'):
    return f'---\nname: {name}\ndescription: 按需复用\n---\n{body}\n'.encode()


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for path, data in files.items():
            archive.writestr(path, data)
    return buffer.getvalue()


def service(tmp_path, **options):
    settings = Settings(_env_file=None, **options)
    return SkillService(MemorySkills(), SkillStorage(tmp_path, settings), SimpleNamespace(fetch=AsyncMock()), settings)


async def install(s, files=None, name='example'):
    op = await s.create_import(uuid.uuid4().hex, kind='zip', raw=zipped(files or {'SKILL.md': source(name)}))
    c = op['candidates'][0]
    return (await s.publish(op['id'], c['path'], c['version']))['result']


@pytest.mark.parametrize('path', ['../bad', '/absolute', 'foo\\bar', 'a/../b', 'A./x', 'CON/file'])
def test_unsafe_archives_rejected(path):
    with pytest.raises(SkillError):
        unzip(zipped({path: b'x'}), Settings(_env_file=None))


def test_archive_links_duplicates_size_and_hash():
    settings = Settings(_env_file=None, skill_file_bytes=1000)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        link = zipfile.ZipInfo('link'); link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, '/tmp/out')
    with pytest.raises(SkillError): unzip(buf.getvalue(), settings)
    with pytest.raises(SkillError): unzip(zipped({'A.txt': b'x', 'a.txt': b'y'}), settings)
    with pytest.raises(SkillError): unzip(zipped({'big': b'a' * 1001}), settings)
    with pytest.raises(SkillError): unzip(zipped({'a': b'x', 'a/b': b'y'}), settings)
    one = candidates(unzip(zipped({'outer/SKILL.md': source()}), settings), settings)[0]
    two = candidates(unzip(zipped({'other/SKILL.md': source()}), settings), settings)[0]
    assert one['version'] == two['version']


@pytest.mark.parametrize('raw', [source('compress'), source('plan-mode'), b'no frontmatter', b'---\nname: ../bad\ndescription: text\n---\nbody', b'---\nname: example\ndescription: !!python/object/apply:os.system [echo]\n---\nbody'])
def test_frontmatter_rejected(raw):
    with pytest.raises(SkillError): parse_skill(raw, Settings(_env_file=None))


def test_prepare_local_shapes():
    settings = Settings(_env_file=None)
    renamed = prepare_local({'notes.md': source(), 'a.txt': b'hi'}, settings)
    assert set(renamed) == {'SKILL.md', 'a.txt'} and renamed['SKILL.md'] == source()
    packed = prepare_local({'bundle.zip': zipped({'outer/SKILL.md': source(), 'outer/a.txt': b'z'})}, settings, unpack_zip=True)
    assert packed['outer/SKILL.md'] == source() and packed['outer/a.txt'] == b'z'
    kept = prepare_local({'pack.zip': zipped({'SKILL.md': source()})}, settings)
    assert set(kept) == {'pack.zip'}
    folder = prepare_local({'skill/SKILL.md': source(), 'skill/scripts/run.py': b'print(1)\n', 'skill/assets/data.zip': b'PK'}, settings)
    assert 'skill/scripts/run.py' in folder and 'skill/assets/data.zip' in folder
    with pytest.raises(SkillError): prepare_local({'a.md': source(), 'b.md': source()}, settings)
    with pytest.raises(SkillError): prepare_local({'SKILL.md': source(), 'guide.md': '# notes\n'.encode()}, settings)
    with pytest.raises(SkillError): prepare_local({'SKILL.md': source(), '.git/config': b'x'}, settings)
    with pytest.raises(SkillError): prepare_local({'repo.zip': zipped({'SKILL.md': source(), 'node_modules/pkg/index.js': b'1'})}, settings, unpack_zip=True)
    with pytest.raises(SkillError): prepare_local({'pack.zip': b'zip', 'a.txt': b'x'}, settings, unpack_zip=True)


def test_local_import_matches_normalized_files(tmp_path):
    async def run():
        s = service(tmp_path)
        files = {'notes.md': source(), 'a.txt': b'one'}
        op = await s.create_import(uuid.uuid4().hex, kind='local', files=files)
        assert op['source']['kind'] == 'local'
        assert {item['path'] for item in op['candidates'][0]['files']} == {'SKILL.md', 'a.txt'}
        again = await s.create_import(op['id'], kind='local', files=files)
        assert again == op
        with pytest.raises(SkillError): await s.create_import(op['id'], kind='local', files={'notes.md': source(body='different')})
        wrapped = await s.create_import(uuid.uuid4().hex, kind='local', files={'bundle.zip': zipped({'outer/SKILL.md': source()})}, unpack_zip=True)
        assert wrapped['candidates'][0]['path'] == 'outer'
    asyncio.run(run())


def test_service_management_versions_and_restart(tmp_path):
    async def run():
        s = service(tmp_path)
        await s.initialize()
        builtin = (await s.list())[0]
        assert builtin['name'] == 'find-skills' and builtin['builtin']
        await s.change(builtin['name'], builtin['version'], enabled=False)
        await s.initialize()
        assert not (await s.list())[0]['enabled']
        with pytest.raises(SkillError): await s.change(builtin['name'], builtin['version'], delete=True)
        entry = await install(s, {'SKILL.md': source(), 'references/data.txt': b'one\ntwo\n', 'assets/icon.bin': b'\x00\x01'})
        assert (await install(s, {'SKILL.md': source(), 'references/data.txt': b'one\ntwo\n', 'assets/icon.bin': b'\x00\x01'}))['version'] == entry['version']
        await s.bind_run('run-one')
        loaded = await s.load('run-one', 'example')
        op = await s.edit('example', entry['version'], source(body='新版方法').decode())
        assert op['result']['version'] != entry['version']
        detail = await s.detail('example')
        assert {f['path'] for f in detail['files']} == {'SKILL.md', 'references/data.txt', 'assets/icon.bin'}
        assert (await s.load('run-one', 'example'))['text'] == loaded['text']
        with pytest.raises(SkillError): await s.edit('example', entry['version'], source().decode())
        assert (await s.resource('run-one', 'example', 'references/data.txt', 2, 2))['text'] == 'two\n'
        assert (await s.resource('run-one', 'example', 'assets/icon.bin'))['binary']
        with pytest.raises(SkillError): await s.resource('run-one', 'example', '../bad')
        await s.change('example', detail['version'], delete=True)
        assert (await s.load('run-one', 'example'))['version'] == entry['version']
        await s.bind_run('run-two')
        with pytest.raises(SkillError): await s.load('run-two', 'example')
    asyncio.run(run())


def test_operations_concurrency_ownership_and_fault_retry(tmp_path):
    async def run():
        s = service(tmp_path)
        id = uuid.uuid4().hex
        op = await s.create_import(id, kind='manual', text=source().decode())
        assert (await s.create_import(id, kind='manual', text=source().decode())) == op
        with pytest.raises(SkillError): await s.create_import(id, kind='manual', text=source(body='different').decode())
        c = op['candidates'][0]
        with pytest.raises(SkillError): await s.publish(id, c['path'], c['version'], owner='wrong-run')
        before = s.repository.put
        async def fail(table, key, value):
            if table == 'skills': raise RuntimeError('injected database failure after filesystem publish')
            await before(table, key, value)
        s.repository.put = fail
        with pytest.raises(RuntimeError): await s.publish(id, c['path'], c['version'])
        assert await s.list() == [] and (await s.operation(id))['stage'] == 'ready'
        s.repository.put = before
        results = await asyncio.gather(s.publish(id, c['path'], c['version']), s.publish(id, c['path'], c['version']))
        assert results[0]['result'] == results[1]['result']
        other = await s.create_import(uuid.uuid4().hex, kind='manual', text=source(body='conflict').decode())
        with pytest.raises(SkillError): await s.publish(other['id'], '', other['candidates'][0]['version'])
        owned = await s.create_import(uuid.uuid4().hex, kind='manual', text=source('another').decode(), owner='run-stop')
        await s.cancel_run('run-stop')
        with pytest.raises(SkillError): await s.publish(owned['id'], '', owned['candidates'][0]['version'], owner='run-stop')
        assert (await s.operation(owned['id']))['stage'] == 'cancelled'
    asyncio.run(run())


def test_integrity_budgets_and_builtin_conflict(tmp_path):
    async def run():
        s = service(tmp_path, skill_catalog_chars=300, skill_active_chars=10)
        entry = await install(s)
        await s.bind_run('run')
        with pytest.raises(SkillError): await s.load('run', 'example')
        with pytest.raises(SkillError): await install(s, name='a-second-name')
        (tmp_path / 'versions' / entry['version'] / 'SKILL.md').write_bytes(b'damaged')
        with pytest.raises(SkillError): await s.detail('example')
    asyncio.run(run())


def test_chat_install_multicandidate_uses_same_operation(tmp_path):
    async def run():
        s = service(tmp_path)
        s.github.fetch.return_value = ({'a/SKILL.md': source('alpha'), 'b/SKILL.md': source('beta')}, None,
                                      {'kind': 'github', 'url': 'https://github.com/owner/repo', 'commit': 'a'*40})
        runtime = SkillRuntime(s, 'run', None)
        first = await runtime.install('https://github.com/owner/repo', None, None, False)
        assert first.success and len(first.data['candidates']) == 2 and not await s.list()
        second = await runtime.install('https://github.com/owner/repo', 'b', first.data['operation_id'], True)
        assert second.success and (await s.bindings('run'))[0]['name'] == 'beta'
        assert s.github.fetch.await_count == 1
        third = await runtime.install('https://github.com/other/repo', None, first.data['operation_id'], False)
        assert not third.success
    asyncio.run(run())


def test_github_rejects_cli_and_arbitrary_downloads():
    for url in ['npx skills add owner/repo', 'http://github.com/a/b', 'https://localhost/a/b', 'https://github.com@127.0.0.1/a/b', 'https://skills.sh/a/b', 'https://github.com/a/b/tree/main/%2e%2e']:
        with pytest.raises(SkillError): GitHubSkills.parse(url)


def test_runtime_explicit_auto_and_new_run_deactivation(tmp_path):
    async def run():
        s = service(tmp_path)
        entry = await install(s)
        runtime = SkillRuntime(s, 'first-run', None)
        await runtime.initialize()
        h = make_loop([text('已按方法完成')], extra_tools=[SkillTool(runtime)])
        h.loop.skill_runtime, h.loop.run_id = runtime, runtime.run_id
        events = [e async for e in h.loop.invoke(Message(message='执行任务', skill=SkillSelection(id=entry['id'], version=entry['version'])))]
        assert not any(isinstance(e, ErrorEvent) for e in events)
        request = h.llm.requests[0].messages
        bodies = [m for m in request if m.get('_ray_skill', {}).get('kind') == 'body']
        assert len(bodies) == 1 and source().decode() in bodies[0]['content']
        assert user_origins(bodies) == []
        assert not any(m.get('tool_calls') for m in request)
        # 自动加载也只保留一个正文块。
        second_runtime = SkillRuntime(s, 'second-run', None)
        await second_runtime.initialize()
        h2 = make_loop([tool_call('load_skill', {'name': 'example'}), text('完成')], session=h.session, extra_tools=[SkillTool(second_runtime)])
        h2.loop.skill_runtime, h2.loop.run_id = second_runtime, second_runtime.run_id
        _ = [e async for e in h2.loop.invoke(Message(message='新任务'))]
        assert not any(m.get('_ray_skill', {}).get('kind') == 'body' for m in h2.llm.requests[0].messages)
        assert len([m for m in h2.llm.requests[1].messages if m.get('_ray_skill', {}).get('kind') == 'body']) == 1
        # 等待恢复时从固定版本恢复活动正文。
        restored = SkillRuntime(s, 'second-run', None)
        await restored.initialize(frozen=True)
        assert source().decode() in (await restored.context())[-1]['content']
    asyncio.run(run())


def test_explicit_selection_approval_and_deny_before_business_request(tmp_path):
    async def run():
        s = service(tmp_path)
        entry = await install(s)
        runtime = SkillRuntime(s, 'approval-run', None)
        await runtime.initialize()
        h = make_loop([text('完成')], extra_tools=[SkillTool(runtime)], tool_policy={'load_skill': 'ask'})
        h.loop.skill_runtime, h.loop.run_id = runtime, runtime.run_id
        events = [e async for e in h.loop.invoke(Message(message='使用方法', skill=SkillSelection(id=entry['id'], version=entry['version'])))]
        approval = next(e for e in events if isinstance(e, ApprovalEvent))
        assert h.llm.requests == []
        assert not any(e.get('tool_calls') for e in memory_messages(h.session))
        from app.domain.models.event import ApprovalStatus
        _ = [e async for e in h.loop.resume_approval(approval.tool_call_id, ApprovalStatus.APPROVED)]
        assert len(h.llm.requests) == 1
        assert any(m.get('_ray_skill', {}).get('kind') == 'body' for m in h.llm.requests[0].messages)
        runtime2 = SkillRuntime(s, 'deny-run', None)
        await runtime2.initialize()
        h2 = make_loop([], extra_tools=[SkillTool(runtime2)], tool_policy={'load_skill': 'deny'})
        h2.loop.skill_runtime, h2.loop.run_id = runtime2, runtime2.run_id
        events = [e async for e in h2.loop.invoke(Message(message='使用方法', skill=SkillSelection(id=entry['id'], version=entry['version'])))]
        assert any(isinstance(e, ErrorEvent) for e in events) and not h2.llm.requests
        assert not (await s.bindings('deny-run'))[0]['active']
    asyncio.run(run())


def test_plan_mode_install_and_prepare_rejected(tmp_path):
    async def run():
        s = service(tmp_path)
        runtime = SkillRuntime(s, 'plan-run', None)
        await runtime.initialize()
        h = make_loop([tool_call('install_skill', {'source_url': 'https://github.com/owner/repo'}), text('计划完成')], extra_tools=[SkillTool(runtime)])
        h.loop.skill_runtime, h.loop.run_id, h.loop.mode = runtime, runtime.run_id, RunMode.PLAN
        _ = [e async for e in h.loop.invoke(Message(message='调研'))]
        s.github.fetch.assert_not_awaited()
        assert not await s.list()
    asyncio.run(run())


def test_compaction_preserves_full_skill_body_without_user_reinjection(tmp_path):
    async def run():
        from app.domain.services.context.compactor import Compactor
        from app.domain.models.app_config import AgentConfig
        from tests.support.scripted_llm import ScriptedLLM
        s = service(tmp_path)
        await install(s)
        runtime = SkillRuntime(s, 'compact-run', None)
        await runtime.initialize()
        await runtime.load('example')
        blocks = await runtime.context()
        llm = ScriptedLLM([text('任务历史摘要')], context_window=32000, max_tokens=4096)
        compactor = Compactor(llm, AgentConfig(compact_keep_turns=1))
        messages = [{'role': 'system', 'content': 'system'}, {'role': 'user', 'content': '原始要求'}, *blocks,
                    {'role': 'assistant', 'content': 'a'}, {'role': 'assistant', 'content': 'b'}, {'role': 'assistant', 'content': 'c'}]
        result = await compactor.compact(messages, [], compactor.fresh_budget().estimate(messages, []), 'manual', AsyncMock(return_value=[]), False)
        body = next(m for m in blocks if m['_ray_skill']['kind'] == 'body')
        assert result.status.value == 'compacted' and result.messages.count(body) == 1
        assert not any(m.get('_ray_skill') for m in result.messages if m.get('content') == '原始要求')
        assert source().decode() in body['content']
    asyncio.run(run())


def test_github_resolves_slashed_ref_and_rejects_redirect(monkeypatch):
    import httpx
    from app.infrastructure.external.skills import github as module
    original = httpx.AsyncClient
    visited = []
    archive = zipped({'repo-root/skills/example/SKILL.md': source()})
    def respond(request):
        visited.append(str(request.url))
        if request.url.host == 'codeload.github.com':
            return httpx.Response(200, content=archive)
        ref = request.url.path.split('/commits/', 1)[-1]
        if ref in ('feature/topic', 'a' * 40):
            return httpx.Response(200, json={'sha': 'a' * 40})
        return httpx.Response(422, json={'message': 'No commit found'})
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    async def run():
        files, directory, metadata = await GitHubSkills(Settings(_env_file=None)).fetch('https://github.com/owner/repo/tree/feature/topic/skills/example')
        assert directory == 'skills/example' and metadata['commit'] == 'a' * 40
        assert candidates(files, Settings(_env_file=None), directory)[0]['name'] == 'example'
        assert all(httpx.URL(url).host in ('api.github.com', 'codeload.github.com') for url in visited)
        def redirect(request): return httpx.Response(302, headers={'Location': 'http://127.0.0.1/private'})
        monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(redirect), **kwargs))
        with pytest.raises(SkillError): await GitHubSkills(Settings(_env_file=None)).fetch('https://github.com/owner/repo')
    asyncio.run(run())


def test_github_archive_only_validates_selected_material():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        link = zipfile.ZipInfo('repo/CLAUDE.md'); link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, 'AGENTS.md')
        archive.writestr('repo/skills/example/SKILL.md', source())
    settings = Settings(_env_file=None)
    files = unzip(buffer.getvalue(), settings, github_archive=True, directory='skills/example')
    assert list(files) == ['repo/skills/example/SKILL.md']
    assert unzip(buffer.getvalue(), settings, github_archive=True) == files
    with pytest.raises(SkillError): unzip(buffer.getvalue(), settings)


def test_collection_between_file_publish_and_registration_is_repaired(tmp_path):
    async def run():
        s = service(tmp_path)
        original, raced = s.storage.write, False
        def write(namespace, key, files):
            nonlocal raced
            original(namespace, key, files)
            if namespace == 'versions' and not raced:
                raced = True
                s.storage.remove(namespace, key)
        s.storage.write = write
        await install(s)
        assert (await s.detail('example'))['text'] == source().decode()
    asyncio.run(run())


def test_reimport_repairs_damaged_immutable_copy_without_new_version(tmp_path):
    async def run():
        s = service(tmp_path)
        entry = await install(s)
        (tmp_path / 'versions' / entry['version'] / 'SKILL.md').write_bytes(b'damaged')
        with pytest.raises(SkillError): await s.detail('example')
        repaired = await install(s)
        assert repaired['version'] == entry['version']
        assert (await s.detail('example'))['text'] == source().decode()
    asyncio.run(run())
