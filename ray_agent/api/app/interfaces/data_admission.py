"""写请求先取得共享锁；清理受理以独占锁固定清单，拒绝迟到的目标写入。"""
from fastapi import Request
from app.infrastructure.storage.postgres import get_session_factory
from app.infrastructure.repositories.db_data_cleanup_repository import DBDataCleanupRepository


async def data_admission(request: Request):
    path = request.url.path.removeprefix('/api')
    if request.method in ('GET', 'HEAD', 'OPTIONS') or path.startswith(('/data', '/app-config', '/status')) or path in ('/sessions/stream', '/files/download-batch'):
        yield
        return
    factory = get_session_factory()
    project_id = request.query_params.get('project_id')
    if request.headers.get('content-type', '').startswith('application/json'):
        body = await request.json()
        if isinstance(body, dict):
            project_id = body.get('project_id', project_id)
    async with DBDataCleanupRepository(factory).admission(path, project_id):
        yield
