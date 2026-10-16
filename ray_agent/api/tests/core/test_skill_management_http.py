"""HTTP 路由和公共依赖使用真实实现，数据库受理锁使用记录替身。"""
import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from unittest.mock import patch
import httpx
from fastapi import FastAPI, Depends
from app.interfaces.data_admission import data_admission
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
        assert [x['name'] for x in await s.list()] == ['find-skills', 'aaa', 'zzz']
        app = FastAPI()
        app.include_router(router, prefix='/api', dependencies=[Depends(data_admission)])
        app.dependency_overrides[get_skill_service] = lambda: s
        register_exception_handlers(app)
        admitted = []
        class Admission:
            def __init__(self, factory): pass
            @asynccontextmanager
            async def admission(self, path, project_id):
                admitted.append((path, project_id))
                yield
        with patch('app.interfaces.data_admission.get_session_factory', return_value=None), patch('app.interfaces.data_admission.DBDataCleanupRepository', Admission):
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
                assert admitted[-1][0] == '/skills/example'
                assert (await client.request('DELETE', '/api/skills/aaa?expected_version=x', content=b'{', headers={'content-type':'application/json'})).status_code == 400
                builtin = (await s.list())[0]
                assert (await client.delete('/api/skills/find-skills', params={'expected_version':builtin['version']})).status_code == 409
    asyncio.run(scenario())
