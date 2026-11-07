"""skill 管理、多来源发现与运行绑定；所有入口共享此服务。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Callable

from app.domain.models.app_config import SkillConfig
from app.domain.repositories.skills import SkillRepository
from app.domain.services.skill_context import catalog_message, body_message
from app.domain.services.skill_discovery import (
    SOURCE_PRIORITY, convention_sources, discover_packages, resolve_aliases, resolve_names,
)
from app.domain.services.skill_packages import SkillError, candidates, local_request_bytes, parse_skill, prepare_local, unzip


class SkillService:
    def __init__(self, repository: SkillRepository, storage, github, settings,
                 *, config_loader: Callable[[], SkillConfig | asyncio.Future] | None = None,
                 workspace_locator=None):
        self.repository, self.storage, self.github, self.settings = repository, storage, github, settings
        self._config_loader = config_loader
        self._workspace_locator = workspace_locator

    async def _config(self) -> SkillConfig:
        if self._config_loader is None:
            return SkillConfig()
        loaded = self._config_loader()
        if asyncio.iscoroutine(loaded):
            loaded = await loaded
        return loaded if isinstance(loaded, SkillConfig) else SkillConfig.model_validate(loaded)

    async def _locate_workspace(self, workspace_id: str | None = None, session_id: str | None = None):
        if self._workspace_locator is None:
            return None, workspace_id
        result = self._workspace_locator(workspace_id or "", session_id=session_id)
        if asyncio.iscoroutine(result):
            result = await result
        return result

    def snapshot_root(self, version: str) -> Path:
        """已发布快照的稳定根路径；本地执行直接映射，不随外部目录瞬时变化。"""
        return self.storage._dir("versions", version)

    async def list(self, *, workspace_id: str | None = None, refresh: bool = True):
        if refresh:
            await self.refresh_catalog(workspace_id=workspace_id)
        async with self.repository.transaction() as tx:
            entries = await tx.all('skills')
        return self._present(entries, await self._config())

    def _present(self, entries: list[dict], config: SkillConfig) -> list[dict]:
        disabled = set(config.disabled_skills)
        visible = []
        for entry in entries:
            item = dict(entry)
            if item['id'] in disabled:
                item['enabled'] = False
            if item.get('version'):
                try:
                    item['root_path'] = str(self.snapshot_root(item['version']))
                except SkillError:
                    item['root_path'] = None
            visible.append(item)
        selected, conflicts = resolve_names(
            [e for e in visible if e.get('status', 'available') != 'missing' or e.get('builtin')],
            config.preferred)
        conflict_ids = {e['id'] for e in conflicts}
        for item in visible:
            item['conflict'] = item['id'] in conflict_ids
            item['auto_bound'] = any(s['id'] == item['id'] for s in selected) and item.get('enabled', True)
        return sorted(visible, key=lambda r: (
            not r.get('builtin', False),
            SOURCE_PRIORITY.get((r.get('source') or {}).get('kind', 'managed'), 99),
            r['name'], r['id']))

    async def detail(self, skill_id: str):
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', skill_id)
            version = await tx.get('versions', entry['version']) if entry else None
        if not entry or not version:
            raise SkillError('Skill 不存在', 404)
        raw = await asyncio.to_thread(self.storage.read, version['version'], version['files'], 'SKILL.md')
        root = str(self.snapshot_root(version['version']))
        return {**version, **entry, 'text': raw.decode('utf-8-sig'), 'root_path': root}

    async def operation(self, operation_id):
        async with self.repository.transaction() as tx:
            op = await tx.get('imports', operation_id)
        if not op:
            raise SkillError('导入操作不存在', 404)
        return op

    async def file(self, skill_id, expected_version, path):
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', skill_id)
            version = await tx.get('versions', expected_version) if entry else None
        if not entry:
            raise SkillError('Skill 不存在', 404)
        if entry['version'] != expected_version:
            raise SkillError('Skill 版本已变化，请刷新', 409)
        if not version:
            raise SkillError('Skill 版本缺失，请重新导入', 409)
        return await asyncio.to_thread(self.storage.read, expected_version, version['files'], path)

    async def import_file(self, operation_id, candidate_path, fingerprint, path):
        op, candidate = await self.readable_import(operation_id, candidate_path, fingerprint)
        prefix = candidate_path + '/' if candidate_path else ''
        return await asyncio.to_thread(self.storage.read, operation_id, candidate['files'], path,
                                       namespace='previews', prefix=prefix)

    async def readable_import(self, operation_id, candidate_path, fingerprint):
        op = await self.operation(operation_id)
        if op.get('owner') is not None:
            raise SkillError('此导入属于聊天运行，请在原对话中续接', 403)
        if op['stage'] != 'ready' or time.time() - op['created_at'] > self.settings.skill_preview_seconds:
            raise SkillError('材料已失效，请重新获取', 409)
        candidate = next((c for c in op['candidates'] if c['path'] == candidate_path and c['version'] == fingerprint), None)
        if not candidate:
            raise SkillError('候选或内容指纹不匹配', 409)
        return op, candidate

    async def revise_import(self, operation_id, candidate_path, fingerprint, text, revision_id):
        op, candidate = await self.readable_import(operation_id, candidate_path, fingerprint)
        prefix = candidate_path + '/' if candidate_path else ''
        files = {f['path']: await asyncio.to_thread(self.storage.read, operation_id, candidate['files'], f['path'],
                 namespace='previews', prefix=prefix) for f in candidate['files']}
        files['SKILL.md'] = text.encode()
        revised = await self.create_import(revision_id, kind='local', files=files,
            update_name=op.get('update_name'), expected_version=op.get('expected_version'))
        async with self.repository.transaction() as tx:
            revised = {**revised, 'source': {**op['source'], 'path': candidate_path, 'edited': True}}
            await tx.put('imports', revised['id'], revised)
        return revised

    async def create_import(self, operation_id, *, kind, url=None, raw=None, text=None, files=None, unpack_zip=False, update_name=None, expected_version=None, owner=None, tool_call_id=None):
        try:
            operation_id = uuid.UUID(operation_id).hex
        except (ValueError, TypeError):
            raise SkillError('需要有效的导入操作 ID')
        if kind not in ('github', 'zip', 'manual', 'local'):
            raise SkillError('不支持的来源')
        if kind == 'github' and not url:
            raise SkillError('请提供公开 GitHub 地址')
        if kind == 'zip' and not raw:
            raise SkillError('请选择非空 ZIP 包')
        if kind == 'local' and not files:
            raise SkillError('请选择 Skill 文件')
        identity = [kind, update_name, expected_version, owner]
        if kind == 'local':
            identity.append(bool(unpack_zip))
            content = local_request_bytes(files)
        else:
            content = raw if kind == 'zip' else (url if kind == 'github' else text or '').encode()
        fingerprint = hashlib.sha256(content + json.dumps(identity).encode()).hexdigest()
        async with self.repository.transaction(run_id=owner) as tx:
            existing = await tx.get('imports', operation_id)
            if existing:
                if existing['request'] != fingerprint:
                    raise SkillError('操作 ID 已用于其他导入', 409)
                return existing
            op = {'id': operation_id, 'request': fingerprint, 'stage': 'fetching', 'created_at': time.time(),
                  'source': {'kind': kind, 'url': url}, 'update_name': update_name, 'expected_version': expected_version,
                  'owner': owner, 'tool_call_id': tool_call_id, 'candidates': [], 'error': None, 'result': None}
            await tx.put('imports', operation_id, op)
        try:
            if kind == 'github':
                files, directory, source = await self.github.fetch(url)
            elif kind == 'zip':
                files = await asyncio.to_thread(unzip, raw, self.settings)
                directory, source = None, {'kind': 'zip'}
            elif kind == 'local':
                files = await asyncio.to_thread(prepare_local, files, self.settings, unpack_zip=unpack_zip)
                directory, source = None, {'kind': 'local'}
            else:
                files, directory, source = {'SKILL.md': (text or '').encode()}, None, {'kind': 'manual'}
            async with self.repository.transaction() as tx:
                op = await tx.get('imports', operation_id)
                if op['stage'] != 'fetching':
                    return op
                op = {**op, 'stage': 'validating', 'source': source}
                await tx.put('imports', operation_id, op)
            found = await asyncio.to_thread(candidates, files, self.settings, directory)
            await asyncio.to_thread(self.storage.write, 'previews', operation_id, files)
            async with self.repository.transaction() as tx:
                latest = await tx.get('imports', operation_id)
                if latest['stage'] != 'validating':
                    return latest
                op = {**op, 'stage': 'ready', 'candidates': found}
                await tx.put('imports', operation_id, op)
            return op
        except BaseException as exc:
            async with self.repository.transaction() as tx:
                current = await tx.get('imports', operation_id)
                if current and current['stage'] not in ('completed', 'cancelled'):
                    await tx.put('imports', operation_id, {**current, 'stage': 'interrupted' if isinstance(exc, asyncio.CancelledError) else 'failed',
                                                         'error': str(exc) or '导入已中断，请重新获取'})
            raise

    async def _check_budget(self, tx, replacement=None, remove=None, extras=None):
        entries = {e['id']: e for e in await tx.all('skills')}
        if replacement:
            entries[replacement['id']] = replacement
        if remove:
            entries.pop(remove, None)
        if extras:
            for item in extras:
                entries[item['id']] = item
        enabled = [e for e in entries.values() if e.get('enabled') and e.get('status', 'available') == 'available']
        size = len(catalog_message('', enabled)['content'])
        if size > self.settings.skill_catalog_chars:
            raise SkillError('Skill 目录超过上下文预算，请缩短描述或停用部分 Skill', 409)

    async def publish(self, operation_id, candidate_path, fingerprint, *, owner=None):
        op = await self.operation(operation_id)
        if op['owner'] != owner:
            raise SkillError('导入操作不属于此入口或运行', 403)
        if op['stage'] == 'completed':
            if op.get('selected_path') != candidate_path or op.get('selected_version') != fingerprint:
                raise SkillError('此操作已发布其他候选，请新建导入', 409)
            return op
        if op['stage'] != 'ready' or time.time() - op['created_at'] > self.settings.skill_preview_seconds:
            raise SkillError('导入未准备好或预览已过期，请重新获取', 409)
        candidate = next((c for c in op['candidates'] if c['path'] == candidate_path and c['version'] == fingerprint), None)
        if not candidate:
            raise SkillError('候选或预览指纹不匹配', 409)
        files = await asyncio.to_thread(self.storage.read_all, 'previews', operation_id)
        prefix = candidate_path + '/' if candidate_path else ''
        bundle = {p[len(prefix):]: d for p, d in files.items() if p.startswith(prefix)}
        checked = (await asyncio.to_thread(candidates, bundle, self.settings))[0]
        if checked['version'] != fingerprint:
            raise SkillError('预览内容已经改变', 409)
        await asyncio.to_thread(self.storage.write, 'versions', fingerprint, bundle)
        name = candidate['name']
        skill_id = name  # 应用管理库：id 与包名相同
        version = {**candidate, 'source': {**op['source'], 'path': candidate_path, 'kind': op['source'].get('kind', 'local')}}
        version['context_chars'] = len(body_message('', {**version, 'text': candidate['text']}, self.settings.skill_resource_chars)['content'])
        version.pop('text', None)
        async with self.repository.transaction(run_id=owner) as tx:
            current_op = await tx.get('imports', operation_id)
            if current_op['stage'] == 'completed':
                if current_op.get('selected_path') != candidate_path or current_op.get('selected_version') != fingerprint:
                    raise SkillError('此操作已发布其他候选，请新建导入', 409)
                return current_op
            if current_op['stage'] != 'ready':
                raise SkillError('导入已取消或中断', 409)
            existing = await tx.get('skills', skill_id)
            if existing and existing.get('builtin'):
                raise SkillError('同名内置 Skill 只能由应用升级更新', 409)
            if existing and (existing.get('source') or {}).get('kind') not in (None, 'managed', 'github', 'local', 'zip', 'manual', 'builtin'):
                raise SkillError('同名外部 Skill 已存在，请在设置中停用或另选名称', 409)
            if op['update_name']:
                if name != op['update_name'] or not existing or existing['version'] != op['expected_version']:
                    raise SkillError('Skill 已更新或名称改变，请刷新后重试', 409)
            elif existing and existing['version'] != fingerprint:
                raise SkillError('同名 Skill 内容不同，请使用更新入口', 409)
            source = {**version['source'], 'kind': 'managed' if version['source'].get('kind') in ('local', 'zip', 'manual', 'github') else version['source'].get('kind', 'managed')}
            if version['source'].get('kind') == 'github':
                source['kind'] = 'github'
            entry = existing if existing and existing['version'] == fingerprint else {
                'id': skill_id, 'name': name, 'description': candidate['description'], 'version': fingerprint,
                'enabled': existing['enabled'] if existing else True, 'builtin': False,
                'source': source, 'status': 'available', 'external': False}
            await self._check_budget(tx, entry)
            await asyncio.to_thread(self.storage.write, 'versions', fingerprint, bundle)
            if not await tx.get('versions', fingerprint):
                await tx.put('versions', fingerprint, version)
            await tx.put('skills', skill_id, entry)
            op = {**current_op, 'stage': 'completed', 'result': entry, 'selected_path': candidate_path, 'selected_version': fingerprint}
            await tx.put('imports', operation_id, op)
        return op

    async def edit(self, skill_id, expected_version, text):
        detail = await self.detail(skill_id)
        if detail.get('builtin') or detail.get('external'):
            raise SkillError('外部引用与内置 Skill 不可在应用内编辑正文', 409)
        files = {f['path']: await asyncio.to_thread(self.storage.read, detail['version'], detail['files'], f['path']) for f in detail['files']}
        files['SKILL.md'] = text.encode()
        import io, zipfile
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for path, data in files.items():
                archive.writestr(path, data)
        op = await self.create_import(uuid.uuid4().hex, kind='zip', raw=buffer.getvalue(), update_name=detail['name'], expected_version=expected_version)
        async with self.repository.transaction() as tx:
            op = {**(await tx.get('imports', op['id'])), 'source': {**detail['source'], 'edited': True}}
            await tx.put('imports', op['id'], op)
        return await self.publish(op['id'], op['candidates'][0]['path'], op['candidates'][0]['version'])

    async def change(self, skill_id, expected_version, *, enabled=None, delete=False):
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', skill_id)
            if not entry:
                if delete:
                    return
                raise SkillError('Skill 不存在', 404)
            if entry['version'] != expected_version:
                raise SkillError('Skill 版本已变化，请刷新', 409)
            if delete:
                if entry.get('builtin'):
                    raise SkillError('内置 Skill 可以停用，不能删除', 409)
                # 外部引用只移除登记，不删除用户目录
                await tx.delete('skills', skill_id)
                return
            entry = {**entry, 'enabled': enabled}
            await self._check_budget(tx, entry)
            await tx.put('skills', skill_id, entry)
        return entry

    async def sources(self, *, workspace_id: str | None = None) -> dict:
        config = await self._config()
        folder, wid = await self._locate_workspace(workspace_id)
        specs = convention_sources(
            workspace_folder=folder, workspace_id=wid,
            discover_user=config.discover_user, discover_workspace=config.discover_workspace,
            extra_dirs=list(config.extra_dirs), disabled_sources=set(config.disabled_sources))
        return {
            'config': config.model_dump(),
            'sources': [
                {
                    'source_id': s.source_id, 'kind': s.kind, 'label': s.label,
                    'path': str(s.root) if s.root else None, 'enabled': s.enabled,
                    'exists': bool(s.root and s.root.exists()) if s.root else True,
                    'workspace_id': s.workspace_id,
                }
                for s in specs
            ],
        }

    async def refresh_catalog(self, *, workspace_id: str | None = None, session_id: str | None = None):
        """扫描外部目录，生成／更新内容快照并登记；已绑定运行不受影响。"""
        config = await self._config()
        folder, wid = await self._locate_workspace(workspace_id, session_id)
        specs = convention_sources(
            workspace_folder=folder, workspace_id=wid,
            discover_user=config.discover_user, discover_workspace=config.discover_workspace,
            extra_dirs=list(config.extra_dirs), disabled_sources=set(config.disabled_sources))
        discovered: list[dict] = []
        for spec in specs:
            if not spec.enabled:
                continue
            discovered.extend(await asyncio.to_thread(discover_packages, spec, self.settings))

        live_ids: set[str] = set()
        for item in discovered:
            if item.get('error'):
                continue
            skill_id = item['id']
            live_ids.add(skill_id)
            bundle = item.pop('bundle')
            await asyncio.to_thread(self.storage.write, 'versions', item['version'], bundle)
            version_meta = {
                'name': item['name'], 'description': item['description'], 'version': item['version'],
                'files': item['files'], 'warnings': item.get('warnings', []),
                'source': {
                    'kind': item['kind'], 'label': item['label'], 'path': item['origin'],
                    'canonical': item['canonical'], 'source_id': item['source_id'],
                },
            }
            version_meta['context_chars'] = len(body_message(
                '', {**version_meta, 'text': item['text']}, self.settings.skill_resource_chars)['content'])
            entry = {
                'id': skill_id, 'name': item['name'], 'description': item['description'],
                'version': item['version'], 'enabled': skill_id not in config.disabled_skills,
                'builtin': False, 'external': True, 'status': 'available',
                'source': version_meta['source'],
            }
            async with self.repository.transaction() as tx:
                old = await tx.get('skills', skill_id)
                if old and old.get('enabled') is False:
                    entry['enabled'] = False
                await self._check_budget(tx, entry)
                if not await tx.get('versions', item['version']):
                    await tx.put('versions', item['version'], version_meta)
                await tx.put('skills', skill_id, entry)

        # 标记已登记但来源消失的外部包；不删快照（运行可能仍引用）
        async with self.repository.transaction() as tx:
            for entry in await tx.all('skills'):
                if not entry.get('external'):
                    continue
                if entry['id'] in live_ids:
                    continue
                # 仅当仍属于当前扫描范围的来源时标 missing
                src = entry.get('source') or {}
                if workspace_id and src.get('kind') == 'workspace' and src.get('source_id', '').startswith(f'workspace:{workspace_id}:'):
                    await tx.put('skills', entry['id'], {**entry, 'status': 'missing', 'enabled': False})
                elif src.get('kind') in ('user', 'extra'):
                    origin = src.get('path')
                    if origin and not Path(origin).exists():
                        await tx.put('skills', entry['id'], {**entry, 'status': 'missing', 'enabled': False})

    async def initialize(self):
        raw = (Path(__file__).parents[2] / 'builtin_skills/find-skills/SKILL.md').read_bytes()
        bundle = {'SKILL.md': raw}
        candidate = candidates(bundle, self.settings)[0]
        await asyncio.to_thread(self.storage.write, 'versions', candidate['version'], bundle)
        async with self.repository.transaction() as tx:
            for op in await tx.all('imports'):
                if op['stage'] in ('fetching', 'validating', 'publishing'):
                    await tx.put('imports', op['id'], {**op, 'stage': 'interrupted', 'error': '服务重启，导入中断，请重新获取'})
            old = await tx.get('skills', candidate['name'])
            if old and not old.get('builtin') and not old.get('external'):
                raise SkillError('内置 find-skills 与用户 Skill 同名，请先更名用户 Skill', 409)
            version = {**candidate, 'source': {'kind': 'builtin', 'label': '内置'}}
            version['context_chars'] = len(body_message('', version, self.settings.skill_resource_chars)['content'])
            version.pop('text', None)
            entry = {k: candidate[k] for k in ('name', 'description', 'version')}
            entry.update(id=candidate['name'], enabled=old['enabled'] if old else True, builtin=True,
                         external=False, status='available', source={'kind': 'builtin', 'label': '内置'})
            await self._check_budget(tx, entry)
            await tx.put('versions', candidate['version'], version)
            await tx.put('skills', candidate['name'], entry)
        await self.collect()

    async def collect(self):
        async with self.repository.transaction() as tx:
            await asyncio.to_thread(self.storage.collect_temporary, self.settings.skill_preview_seconds)
            live = {e['version'] for e in await tx.all('skills')} | await tx.references()
            for op in await tx.all('imports'):
                if time.time() - op['created_at'] > self.settings.skill_preview_seconds:
                    if op['stage'] == 'ready':
                        await tx.put('imports', op['id'], {**op, 'stage': 'expired', 'error': '预览已过期，请重新获取'})
                    await asyncio.to_thread(self.storage.remove, 'previews', op['id'])
            for path in (self.storage.root / 'versions').iterdir():
                if path.name.startswith('.publish-'):
                    continue
                if path.name not in live and time.time() - path.stat().st_mtime > self.settings.skill_preview_seconds:
                    await tx.delete('versions', path.name)
                    await asyncio.to_thread(self.storage.remove, 'versions', path.name)

    async def validate_selection(self, selection):
        if not selection:
            return
        skill_id = selection['id'] if isinstance(selection, dict) else selection.id
        version = selection['version'] if isinstance(selection, dict) else selection.version
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', skill_id)
        if not entry or not entry.get('enabled') or entry['version'] != version or entry.get('status') == 'missing':
            raise SkillError('所选 Skill 已删除、停用、缺失或更新，请刷新选择；草稿已保留', 409)

    def _catalog_for_run(self, entries: list[dict], config: SkillConfig) -> list[dict]:
        available = [e for e in entries
                     if e.get('enabled') and e.get('status', 'available') == 'available'
                     and e['id'] not in config.disabled_skills]
        deduped = resolve_aliases(available)
        selected, _conflicts = resolve_names(deduped, config.preferred)
        return selected

    async def accept(self, uow, session_id, selection):
        """在消息与运行的同一受理事务中校验选择、固定目录和登记版本引用。"""
        tx = uow.skills
        await tx.lock()
        run = await uow.run.get_active(session_id)
        if run is None:
            raise SkillError('活动运行不存在', 409)
        session = await uow.session.get_by_id(session_id)
        workspace_id = getattr(session, 'workspace_id', None) if session else None
        # 发现在受理事务外完成；此处只读已登记目录。调用方应先 refresh。
        entries = await tx.all('skills')
        config = await self._config()
        selected_entry = next((e for e in entries if selection and e['id'] == selection.id), None)
        if selection and (not selected_entry or not selected_entry.get('enabled')
                          or selected_entry['version'] != selection.version
                          or selected_entry.get('status') == 'missing'):
            raise SkillError('所选 Skill 已删除、停用、缺失或更新，请刷新选择', 409)
        if not run.config_snapshot.get('skills_frozen'):
            bound = self._catalog_for_run(entries, config)
            if selection and selected_entry and not any(e['id'] == selection.id for e in bound):
                bound = [*bound, selected_entry]
            for entry in bound:
                payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
                await tx.bind(run.id, entry['id'], entry['version'], payload)
            await uow.run.save_snapshot(run.id, {**run.config_snapshot, 'skills_frozen': True,
                                                 'skill_workspace_id': workspace_id})
        else:
            bound = await tx.bindings(run.id)
        if selection and not any(e['id'] == selection.id and e['version'] == selection.version for e in bound):
            raise SkillError('本运行目录已经固定，请在新运行选择此 Skill 版本', 409)

    async def bind_run(self, run_id, *, workspace_id: str | None = None, session_id: str | None = None):
        await self.refresh_catalog(workspace_id=workspace_id, session_id=session_id)
        config = await self._config()
        async with self.repository.transaction(run_id=run_id) as tx:
            from_snapshot = await tx.bindings(run_id)
            if from_snapshot:
                return from_snapshot
            entries = self._catalog_for_run(await tx.all('skills'), config)
            bound = []
            for entry in entries:
                payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
                await tx.bind(run_id, entry['id'], entry['version'], payload)
                bound.append(payload)
            return bound

    async def bindings(self, run_id):
        async with self.repository.transaction() as tx:
            return await tx.bindings(run_id)

    async def append(self, run_id, entry):
        async with self.repository.transaction(run_id=run_id) as tx:
            latest = await tx.get('skills', entry['id'])
            if not latest or not latest.get('enabled') or latest['version'] != entry['version']:
                raise SkillError('安装结果已被删除、停用或更新，未追加本运行目录', 409)
            bound = await tx.bindings(run_id)
            old = next((b for b in bound if b['id'] == entry['id'] or b['name'] == entry['name']), None)
            if old:
                if old['version'] != entry['version']:
                    raise SkillError('本运行已固定同名旧版本，新版本在新运行生效', 409)
                return old
            if len(catalog_message('', [*bound, entry])['content']) > self.settings.skill_catalog_chars:
                raise SkillError('本运行 Skill 目录容量不足', 409)
            payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
            await tx.bind(run_id, entry['id'], entry['version'], payload)
        return payload

    def _find_bound(self, bound, name_or_id):
        return next((e for e in bound if e['id'] == name_or_id or e['name'] == name_or_id), None)

    async def load(self, run_id, name):
        async with self.repository.transaction() as tx:
            bound = await tx.bindings(run_id)
            entry = self._find_bound(bound, name)
            if not entry:
                raise SkillError('Skill 不在本运行启用目录中', 404)
            version = await tx.get('versions', entry['version'])
            if not version:
                raise SkillError('绑定版本缺失，请重新导入', 409)
        raw = await asyncio.to_thread(self.storage.read, entry['version'], version['files'], 'SKILL.md')
        parsed = parse_skill(raw, self.settings)
        root_path = entry.get('root_path') or str(self.snapshot_root(entry['version']))
        if entry['active']:
            return {**version, 'text': parsed['text'], 'root_path': root_path}
        async with self.repository.transaction() as tx:
            current = await tx.bindings(run_id)
            total = 0
            for item in current:
                if item['active'] or item['id'] == entry['id']:
                    v = await tx.get('versions', item['version'])
                    total += v.get('context_chars', self.settings.skill_body_chars + self.settings.skill_resource_chars + 2048)
            if total > self.settings.skill_active_chars:
                raise SkillError('活动 Skill 正文容量不足，请在新运行减少加载的 Skill', 409)
            await tx.bind(run_id, entry['id'], entry['version'], {**entry, 'active': True, 'root_path': root_path})
        return {**version, 'text': parsed['text'], 'root_path': root_path}

    async def resource(self, run_id, name, path, start_line=1, end_line=None):
        entries = await self.bindings(run_id)
        entry = self._find_bound(entries, name)
        if not entry or not entry.get('active'):
            raise SkillError('请先加载本运行 Skill', 409)
        async with self.repository.transaction() as tx:
            version = await tx.get('versions', entry['version'])
        raw = await asyncio.to_thread(self.storage.read, entry['version'], version['files'], path)
        try:
            text = raw.decode('utf-8')
            if '\x00' in text:
                raise UnicodeError()
        except UnicodeError:
            return {'path': path, 'binary': True, 'size': len(raw), 'note': '请准备 Skill 资源后使用文件工具'}
        lines = text.splitlines(keepends=True)
        if start_line < 1 or (end_line is not None and end_line < start_line):
            raise SkillError('无效行范围')
        requested = min(end_line or len(lines), len(lines))
        output, last = '', start_line - 1
        for index in range(start_line - 1, requested):
            if len(output) + len(lines[index]) > self.settings.skill_resource_chars:
                if not output:
                    raise SkillError('单行过长，请准备资源后使用文件工具')
                break
            output += lines[index]
            last = index + 1
        return {'path': path, 'text': output, 'start_line': start_line, 'end_line': last, 'total_lines': len(lines), 'has_more': last < len(lines)}

    async def mark_prepared(self, run_id, name):
        async with self.repository.transaction() as tx:
            entry = self._find_bound(await tx.bindings(run_id), name)
            if not entry or not entry['active']:
                raise SkillError('材料准备没有对应的活动 Skill', 409)
            await tx.bind(run_id, entry['id'], entry['version'], {**entry, 'prepared': True})

    async def cancel_run(self, run_id):
        async with self.repository.transaction() as tx:
            for op in await tx.all('imports'):
                if op.get('owner') == run_id and op['stage'] in ('fetching', 'validating', 'ready'):
                    await tx.put('imports', op['id'], {**op, 'stage': 'cancelled', 'error': '运行已停止'})
