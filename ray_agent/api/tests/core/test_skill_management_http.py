"""HTTP 路由使用真实实现，skill 仓储为事务替身。"""
import asyncio
import time
import uuid
import httpx
from fastapi import FastAPI
from app.interfaces.endpoints.skill_routes import router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_skill_service
from tests.core.test_skills import service, source, install


def test_management_http_and_resources(tmp_path):
    async def scenario():
        s = service(tmp_path)
        await s.initialize()
        await install(s, name='aaa')
        await install(s, name='zzz')
        assert [x['name'] for x in await s.list() if not x.get('builtin')] == ['aaa', 'zzz']
        app = FastAPI()
        app.include_router(router, prefix='/api')
        app.dependency_overrides[get_skill_service] = lambda: s
        register_exception_handlers(app)
        if True:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                files = {'SKILL.md': source(), 'agents/openai.yaml': b'interface:\n  display_name: Test\n', 'binary.bin': b'\x00\xff'}
                op = await s.create_import(uuid.uuid4().hex, kind='local', files={f'pack/{k}': v for k, v in files.items()})
                c = op['candidates'][0]
                base = f"/api/skills/imports/{op['id']}/file"
                params = {'candidate_path':c['path'], 'fingerprint':c['version'], 'path':'agents/openai.yaml'}
                response = await client.get(base, params=params)
                assert response.content == files['agents/openai.yaml']
                assert response.headers['x-content-type-options'] == 'nosniff'
                for path in ('../SKILL.md', '/etc/passwd', 'missing.yaml'):
                    assert (await client.get(base, params={**params, 'path':path})).status_code in (400, 404)
                response = await client.put(f"/api/skills/imports/{op['id']}/content", json={'candidate_path':c['path'], 'fingerprint':c['version'], 'revision_id':uuid.uuid4().hex, 'text':source(body='修改正文').decode()})
                assert response.status_code == 200
                new = response.json()['data']; nc = new['candidates'][0]
                response = await client.post(f"/api/skills/imports/{new['id']}/publish", json={'candidate_path':nc['path'], 'fingerprint':nc['version']})
                assert response.status_code == 200
                version = response.json()['data']['result']['version']
                fp = {'expected_version':version, 'path':'agents/openai.yaml'}
                assert (await client.get('/api/skills/example/file', params=fp)).content == files['agents/openai.yaml']
                assert (await client.get('/api/skills/example/file', params={**fp, 'expected_version':c['version']})).status_code == 409
                response = await client.get('/api/skills/example/file', params={**fp, 'path':'binary.bin', 'download':'true'})
                assert response.content == files['binary.bin'] and 'attachment' in response.headers['content-disposition']
                (s.storage.root / 'versions' / version / 'agents/openai.yaml').write_bytes(b'changed')
                assert (await client.get('/api/skills/example/file', params=fp)).status_code == 409
                async with s.repository.transaction() as tx:
                    await tx.put('imports', op['id'], {**op, 'created_at':time.time() - s.settings.skill_preview_seconds - 1})
                assert (await client.get(base, params=params)).status_code == 409
                async with s.repository.transaction() as tx:
                    await tx.put('imports', op['id'], {**op, 'owner':'private-run'})
                assert (await client.get(base, params=params)).status_code == 403
                for headers in ({'content-type':'application/json'}, {}):
                    assert (await client.delete('/api/skills/example', params={'expected_version':version}, headers=headers)).status_code == 200
                builtin = next(item for item in await s.list() if item['name'] == 'find-skills')
                assert (await client.delete('/api/skills/find-skills', params={'expected_version':builtin['version']})).status_code == 409
    asyncio.run(scenario())


def test_market_install_targets_and_operation_readback(tmp_path, monkeypatch):
    import pytest
    from app.interfaces.endpoints import skill_routes
    from app.domain.models.app_config import SkillConfig
    from app.domain.services.skill_packages import SkillError
    from app.infrastructure.external.skills.market import SkillMarket, parse_leaderboard
    from app.infrastructure.external.skills.native_install import NativeSkillTarget, install_native_skill

    async def scenario():
        market_html = """
          <a href="/owner/repo/starter"><span>1</span><h3>Starter</h3><span>2.2K</span></a>
          <a href="/owner/repo/advanced"><span>2</span><h3>Advanced</h3><span>911</span></a>
        """
        assert parse_leaderboard(market_html)[0]['count_label'] == '2.2K'
        workspace = tmp_path / 'workspace'
        workspace.mkdir()
        global_root = tmp_path / 'RayAgent'
        s = service(tmp_path / 'data')
        s.global_folder = global_root
        s._workspace_locator = lambda wid, **_: (str(workspace) if wid == 'a' else None, wid)
        files = {'one/SKILL.md': source('starter'), 'one/readme.txt': b'complete package',
                 'two/SKILL.md': source('advanced')}
        s.github.fetch.return_value = (files, None, {'kind': 'github', 'commit': 'a' * 40})
        market = SkillMarket(s.settings)

        async def download(query):
            assert query == ''
            return market_html
        monkeypatch.setattr(market, '_download', download)
        description_reads = []
        advanced_attempts = 0

        async def read_description(url, *, head_only):
            nonlocal advanced_attempts
            assert head_only
            if url == 'https://www.skills.sh/owner/repo/advanced':
                advanced_attempts += 1
                if advanced_attempts == 1:
                    raise TimeoutError
                return '<head><title>没有简介</title></head>'
            assert url == 'https://www.skills.sh/owner/repo/starter'
            description_reads.append(url)
            return '<meta name="description" content="  A real &amp; useful Skill.  ">'

        monkeypatch.setattr(market, '_read', read_description)


        async def locate(_, scope):
            return NativeSkillTarget(workspace, scope) if scope == 'a' else NativeSkillTarget(global_root)

        installs = []
        async def write(svc, scope, root, name, bundle):
            target = await locate(svc, scope)
            assert root == target.id
            installs.append(target.path)
            install_native_skill(target, name, bundle, svc.settings)
            return target.destination(name)
        monkeypatch.setattr(skill_routes, 'native_skill_target', locate)
        monkeypatch.setattr(skill_routes, 'publish_native_skill', write)
        app = FastAPI()
        app.include_router(router, prefix='/api')
        app.dependency_overrides[get_skill_service] = lambda: s
        app.dependency_overrides[skill_routes.get_skill_market] = lambda: market
        register_exception_handlers(app)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            base = '/api/skills'
            catalog = await client.get(base + '/market', params={'limit': 1})
            assert catalog.status_code == 200
            assert catalog.json()['data']['has_more']
            assert catalog.json()['data']['items'][0]['id'] == 'owner/repo/starter'
            for _ in range(2):
                summaries = await client.post(base + '/market/descriptions', json={
                    'ids': ['owner/repo/starter', 'other/repo/unseen', 'owner/repo/starter'],
                })
                assert summaries.json()['data'] == {'owner/repo/starter': 'A real & useful Skill.'}
            assert len(description_reads) == 1
            for expected in ({}, {'owner/repo/advanced': None}):
                summaries = await client.post(base + '/market/descriptions', json={'ids': ['owner/repo/advanced']})
                assert summaries.json()['data'] == expected

            scopes = (await client.get(base + '/market/targets', params={'workspace_id': 'a'})).json()['data']
            assert [entry['workspace_id'] for entry in scopes] == ['a', None]
            for target in scopes:
                payload = {'operation_id': uuid.uuid4().hex, 'repository': 'owner/repo', 'slug': 'starter',
                           'workspace_id': target['workspace_id'], 'target_id': target['target_id']}
                if target['workspace_id'] is None:
                    s._config_loader = lambda: SkillConfig(discover_user=False, disabled_groups=['rayagent'])
                result = await client.post(base + '/market/install', json=payload)
                assert result.status_code == 200, result.text
                op = result.json()['data']
                assert op['stage'] == 'completed'
                assert op['result']['enabled'] == (target['workspace_id'] == 'a')
                assert (await client.post(base + '/market/install', json=payload)).json()['data'] == op
                assert (await client.get(f"{base}/imports/{op['id']}")).json()['data'] == op
                destination = target['directory'] + '/starter'
                assert op['destination'] == destination and op['result']['market']['id'] == 'owner/repo/starter'
            assert installs == [workspace, global_root]
            assert (workspace / '.rayagent/skills/starter/readme.txt').read_bytes() == b'complete package'
            assert (global_root / '.rayagent/skills/starter/SKILL.md').is_file()
            with pytest.raises(SkillError, match='内容不同'):
                install_native_skill(NativeSkillTarget(global_root), 'starter', {'SKILL.md': source('starter', 'changed')}, s.settings)
            assert (global_root / '.rayagent/skills/starter/SKILL.md').read_bytes() == source('starter')
            assert all(row['source']['kind'] != 'workspace' for row in await s.list())

    asyncio.run(scenario())
