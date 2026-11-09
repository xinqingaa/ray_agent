"""Shell 执行区间的有界文件观察；元数据差异不代表写入归属，也不提供撤销。"""
from __future__ import annotations

import uuid

from app.application.errors.exceptions import NotFoundError
from app.domain.models.clock import utc_now
from app.domain.models.identity import RootedPath

KEY = 'shell_file_observation'
_OBSERVER_INSTANCE = uuid.uuid4().hex


class ShellChanges:
    def __init__(self, write, read, *, instance_id=_OBSERVER_INSTANCE):
        self.write, self.read = write, read
        self.instance_id = instance_id

    async def _stored(self, run_id):
        async with self.read() as uow:
            run = await uow.run.get(run_id)
        if run is None:
            raise NotFoundError('运行不存在')
        return run, (run.config_snapshot or {}).get(KEY)

    async def _save(self, run_id, observation):
        async with self.write() as uow:
            run = await uow.run.lock(run_id)
            if run is None:
                raise NotFoundError('运行不存在')
            await uow.run.save_snapshot(run_id, {**run.config_snapshot, KEY: observation})

    @staticmethod
    async def _scan(scope, root_id):
        try:
            snapshot = await scope.files.snapshot(RootedPath(root_id=root_id))
            return {'files': snapshot.files, 'partial': snapshot.truncated, 'error': None}
        except Exception as error:
            return {'files': {}, 'partial': True, 'error': str(error)}

    async def begin(self, run_id, scope):
        _, stored = await self._stored(run_id)
        if stored:
            if stored.get('observer_id') != self.instance_id:
                stored['state'] = 'unknown'
                await self._save(run_id, stored)
            return  # 等待续接沿用第一次实际执行前的清单。
        observation = {'state': 'observing', 'observer_id': self.instance_id,
                       'started_at': utc_now().isoformat(), 'ended_at': None, 'roots': []}
        for root in scope.roots:
            observation['roots'].append({'root_id': root.root_id, 'kind': root.kind.value,
                                         'before': await self._scan(scope, root.root_id), 'after': None})
        await self._save(run_id, observation)

    async def finish(self, run_id, scope, confirmed):
        _, stored = await self._stored(run_id)
        if not stored:
            return
        if stored.get('observer_id') != self.instance_id or stored['state'] == 'unknown':
            stored['state'] = 'unknown'
            await self._save(run_id, stored)
            return
        if stored['state'] == 'complete':
            return
        stored['state'] = 'complete' if confirmed else 'unknown'
        stored['ended_at'] = utc_now().isoformat()
        if confirmed:
            for root in stored['roots']:
                root['after'] = await self._scan(scope, root['root_id'])
        await self._save(run_id, stored)

    async def view(self, session_id, run_id, *, offset, limit):
        run, stored = await self._stored(run_id)
        if run.session_id != session_id:
            raise NotFoundError('该会话中没有这次运行')
        state = stored['state'] if stored else 'not_started'
        if state == 'observing' and run.status.terminal:
            state = 'unknown'  # 崩溃／重启后没有可确认的静止时刻，不补造“运行后”清单。
        if stored and stored.get('observer_id') != self.instance_id and (run.status.active or state != 'complete'):
            state = 'unknown'  # 等待可跨核心恢复，进程与观察区间不能被新实例认领。
        changes, roots = [], []
        for root in (stored or {}).get('roots', []):
            before, after = root['before'], root['after']
            roots.append({'root_id': root['root_id'], 'kind': root['kind'],
                          'before_files': len(before['files']), 'after_files': len(after['files']) if after else None,
                          'partial': before['partial'] or after is None or after['partial'],
                          'errors': [item['error'] for item in (before, after) if item and item['error']]})
            if not after or state != 'complete':
                continue
            for path in sorted(before['files'].keys() | after['files'].keys()):
                old, new = before['files'].get(path), after['files'].get(path)
                if old == new:
                    continue
                operation = ('create' if not before['partial'] else 'unclassified') if old is None else (
                    ('delete' if not after['partial'] else 'unclassified') if new is None else 'modify')
                def version(value):
                    return {'size': value[0], 'modified_ns': str(value[1])} if value else None
                changes.append({'root_id': root['root_id'], 'relative_path': path, 'operation': operation,
                                'before': version(old), 'after': version(new)})
        return dict(run_id=run_id, state=state, started_at=stored['started_at'] if stored else None,
                    ended_at=stored['ended_at'] if stored else None, roots=roots, total=len(changes),
                    entries=changes[offset:offset + limit], has_more=offset + limit < len(changes),
                    attribution='unknown', undo_available=False)

    async def workspace_view(self, workspace_id, run_id, *, offset, limit):
        run, _ = await self._stored(run_id)
        async with self.read() as uow:
            session = await uow.session.get_by_id(run.session_id)
        if session is None or session.workspace_id != workspace_id:
            raise NotFoundError('该工作区中没有这次运行')
        return await self.view(run.session_id, run_id, offset=offset, limit=limit)
