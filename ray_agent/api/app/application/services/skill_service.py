"""skill 管理、多来源发现与运行绑定；所有入口共享此服务。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from pathlib import Path
from collections import OrderedDict
from typing import Callable

from app.domain.models.app_config import SkillConfig
from app.domain.repositories.skills import SkillRepository
from app.domain.services.skill_context import catalog_message, body_message
from app.domain.services.skill_discovery import (
    GROUPS, NATIVE_RELATIVE, SOURCE_PRIORITY, convention_sources, discover_packages, entry_kind, entry_workspace_id,
    resolve_aliases, resolve_names, skill_id_for, source_group, source_id_for,
)
from app.domain.services.skill_packages import SkillError, candidates, local_request_bytes, market_identity, parse_skill, prepare_local, unzip


class SkillDiscoveryState:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.cache = OrderedDict()
        self.problems: dict[str, list[dict]] = {}
        self.pending: dict[tuple, asyncio.Task] = {}


class SkillService:
    def __init__(self, repository: SkillRepository, storage, github, settings,
                 *, config_loader: Callable[[], SkillConfig | asyncio.Future] | None = None,
                 workspace_locator=None, global_folder=None, discovery_state=None, workspace_roots=None):
        self.repository, self.storage, self.github, self.settings = repository, storage, github, settings
        self._config_loader = config_loader
        self._workspace_locator = workspace_locator
        self.global_folder = global_folder
        self._discovery = discovery_state or SkillDiscoveryState()
        self._workspace_roots = workspace_roots

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
        return self._present(entries, await self._config(), workspace_id)

    def _present(self, entries: list[dict], config: SkillConfig, workspace_id: str | None = None) -> list[dict]:
        visible = []
        for entry in self._visible_entries(entries, config, workspace_id):
            item = dict(entry)
            item['configured_enabled'] = bool(entry.get('enabled'))
            item['enabled'] = self._selectable(entry, config)
            item['included'] = self._is_included(entry)
            if item.get('version'):
                try:
                    item['root_path'] = str(self.snapshot_root(item['version']))
                except SkillError:
                    item['root_path'] = None
            visible.append(item)
        eligible = resolve_aliases([e for e in visible if e['enabled']])
        preferred = self._preferred(config, eligible, workspace_id)
        _, conflicts = resolve_names(eligible, preferred)
        name_counts: dict[str, int] = {}
        for item in eligible:
            name_counts[item['name']] = name_counts.get(item['name'], 0) + 1
        conflict_ids = {e['id'] for e in conflicts}
        kept, overflow = self._partition(entries, config, workspace_id)
        overflow_ids = {e['id'] for e in overflow}
        injected_ids = {e['id'] for e in kept}
        for item in visible:
            item['catalog_overflow'] = item['id'] in overflow_ids
            item['conflict'] = item['id'] in conflict_ids
            item['same_name'] = name_counts.get(item['name'], 0) > 1
            item['preferred'] = bool(item['enabled'] and preferred.get(item['name']) == item['id'])
            item['auto_bound'] = item['id'] in injected_ids
        return sorted(visible, key=lambda r: (
            not r.get('builtin', False), SOURCE_PRIORITY.get(entry_kind(r), 99), r['name'], r['id']))

    async def _read_entry(self, tx, skill_id, workspace_id, run_id):
        if run_id:
            entry = next((e for e in await self._scoped_bindings(tx, run_id, workspace_id)
                          if e['id'] == skill_id), None)
        else:
            entry = await tx.get('skills', skill_id)
        if not entry or not self._in_scope(entry, workspace_id) or (not run_id and entry.get('suppressed')):
            raise SkillError('Skill 不存在', 404)
        return entry

    async def detail(self, skill_id: str, *, workspace_id: str | None = None, expected_version=None, run_id=None):
        async with self.repository.transaction() as tx:
            entry = await self._read_entry(tx, skill_id, workspace_id, run_id)
            if expected_version and entry['version'] != expected_version:
                raise SkillError('Skill 版本已变化，请刷新选择', 409)
            version = await tx.get('versions', entry['version'])
        if not version:
            raise SkillError('Skill 版本不存在', 404)
        raw = await asyncio.to_thread(self.storage.read, version['version'], version['files'], 'SKILL.md')
        root = str(self.snapshot_root(version['version']))
        return {**version, **entry, 'text': raw.decode('utf-8-sig'), 'root_path': root}

    async def operation(self, operation_id):
        async with self.repository.transaction() as tx:
            op = await tx.get('imports', operation_id)
        if not op:
            raise SkillError('导入操作不存在', 404)
        return op

    async def file(self, skill_id, expected_version, path, *, workspace_id=None, run_id=None):
        async with self.repository.transaction() as tx:
            entry = await self._read_entry(tx, skill_id, workspace_id, run_id)
            if entry['version'] != expected_version:
                raise SkillError('Skill 版本已变化，请刷新', 409)
            version = await tx.get('versions', expected_version)
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
        if op.get('owner') is not None or op.get('market'):
            raise SkillError('此导入需要在原入口续接', 403)
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

    async def create_import(self, operation_id, *, kind, url=None, raw=None, text=None, files=None, unpack_zip=False, update_name=None, expected_version=None, owner=None, tool_call_id=None, market=None):
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
        if market is not None:
            identity.append(market)
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
            if market is not None:
                op['market'] = market
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

    def _source_state(self, source: dict, config: SkillConfig) -> str:
        kind = source.get('kind')
        sid = source.get('source_id', '')
        if kind not in ('workspace', 'rayagent', 'user', 'extra'):
            return 'enabled'
        group = source.get('group') or source_group(sid)
        if kind == 'extra':
            # extra_dirs contains canonical paths redeemed by the host folder picker.
            if sid not in {source_id_for('extra', path=path) for path in config.extra_dirs}:
                return 'unregistered'
        if (sid in config.disabled_sources or group in config.disabled_groups or
            (kind == 'user' and not config.discover_user) or
            (kind == 'workspace' and group != 'rayagent' and not config.discover_workspace)):
            return 'disabled'
        return 'enabled'

    def _effective_entry(self, entry: dict, config: SkillConfig) -> dict:
        source = entry.get('source') or {}
        variants = entry.get('locations', [])
        if not variants:
            variants = [{'source': source, 'status': entry.get('status', 'available')}]
        choices = [(variant, self._source_state(variant['source'], config)) for variant in variants]
        current, state = min(choices, key=lambda choice: (
            choice[1] == 'unregistered', choice[1] != 'enabled', choice[0]['status'] != 'available',
            choice[0]['source'].get('group') != 'rayagent',
            choice[0]['source'].get('source_id', ''),
        ))
        return {**entry, **current, 'source_state': state}

    def _visible_entries(self, entries: list[dict], config: SkillConfig, workspace_id: str | None) -> list[dict]:
        return [item for entry in entries if self._in_scope(entry, workspace_id) and not entry.get('suppressed')
                if (item := self._effective_entry(entry, config))['source_state'] != 'unregistered']

    def _selectable(self, entry: dict, config: SkillConfig) -> bool:
        return (bool(entry.get('enabled')) and entry.get('status', 'available') == 'available'
                and entry.get('source_state', 'enabled') == 'enabled'
                and entry['id'] not in config.disabled_skills)

    def _is_included(self, entry: dict) -> bool:
        """没有纳入字段的旧登记沿用「启用即进入目录」。"""
        if 'included' in entry:
            return bool(entry['included'])
        return bool(entry.get('enabled', True))

    def _in_scope(self, entry: dict, workspace_id: str | None) -> bool:
        if entry_kind(entry) != 'workspace':
            return True
        return workspace_id is not None and entry_workspace_id(entry) == workspace_id

    def _scopes(self, entries: list[dict]) -> list[str | None]:
        scopes: list[str | None] = [None]
        seen: set[str] = set()
        for entry in entries:
            workspace_id = entry_workspace_id(entry)
            if workspace_id and workspace_id not in seen:
                seen.add(workspace_id)
                scopes.append(workspace_id)
        return scopes

    def _preferred(self, config: SkillConfig, entries: list[dict], workspace_id: str | None) -> dict[str, str]:
        ids = {entry['id'] for entry in entries}
        workspace = config.workspace_preferred.get(workspace_id, {}) if workspace_id else {}
        return {**config.preferred, **{name: key for name, key in workspace.items() if key in ids}}

    def _members(self, entries: list[dict], config: SkillConfig, workspace_id: str | None) -> list[dict]:
        pool = [e for e in self._visible_entries(entries, config, workspace_id)
                if self._selectable(e, config) and self._is_included(e)]
        eligible = resolve_aliases(pool)
        selected, _conflicts = resolve_names(eligible, self._preferred(config, eligible, workspace_id))
        return selected

    def _catalog_size(self, entries: list[dict]) -> int:
        return len(catalog_message('', entries, self.settings.skill_catalog_description_chars)['content'])

    def _fits(self, entries: list[dict], config: SkillConfig) -> bool:
        limit = self.settings.skill_catalog_chars
        return all(self._catalog_size(self._members(entries, config, workspace_id)) <= limit for workspace_id in self._scopes(entries))

    def _partition(self, entries: list[dict], config: SkillConfig, workspace_id: str | None) -> tuple[list[dict], list[dict]]:
        members = self._members(entries, config, workspace_id)
        if self._catalog_size(members) <= self.settings.skill_catalog_chars:
            return members, []
        kept = [e for e in members if e.get('builtin') or entry_kind(e) == 'builtin']
        kept_ids = {e['id'] for e in kept}
        return kept, [e for e in members if e['id'] not in kept_ids]

    def _freeze_bound(self, entries: list[dict], config: SkillConfig, workspace_id: str | None, selection: dict | None) -> list[dict]:
        """已纳入集合放得下就整份冻结。放不下时只保留内置 Skill，不按扫描顺序截断。"""
        members = self._members(entries, config, workspace_id)
        if selection:
            members = [e for e in members if e['name'] != selection['name']] + [selection]
        if self._catalog_size(members) <= self.settings.skill_catalog_chars:
            return members
        if self._catalog_size(self._members(entries, config, workspace_id)) <= self.settings.skill_catalog_chars:
            raise SkillError('本运行 Skill 目录容量不足', 409)
        return [e for e in members if e.get('builtin') or e is selection]

    async def _check_budget(self, tx, replacement: dict, config: SkillConfig):
        entries = {e['id']: e for e in await tx.all('skills')}
        entries[replacement['id']] = replacement
        if not self._fits(list(entries.values()), config):
            raise SkillError('Skill 目录超过上下文预算，请退出部分已纳入的 Skill', 409)

    async def publish(self, operation_id, candidate_path, fingerprint, *, owner=None):
        op = await self.operation(operation_id)
        if op['owner'] != owner or op.get('market'):
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
        config = await self._config()
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
                'included': self._is_included(existing) if existing else True,
                'source': source, 'status': 'available', 'external': False}
            if 'included' not in entry:
                entry = {**entry, 'included': True}
            notice = None
            if entry.get('enabled', True) and self._is_included(entry):
                rows = {item['id']: item for item in await tx.all('skills')}
                rows[entry['id']] = entry
                if not self._fits(list(rows.values()), config):
                    entry = {**entry, 'included': False}
                    notice = '已安装，但目录预算已满，未纳入自动目录'
            await asyncio.to_thread(self.storage.write, 'versions', fingerprint, bundle)
            if not await tx.get('versions', fingerprint):
                await tx.put('versions', fingerprint, version)
            await tx.put('skills', skill_id, entry)
            op = {**current_op, 'stage': 'completed', 'result': entry, 'selected_path': candidate_path, 'selected_version': fingerprint}
            if notice:
                op['notice'] = notice
            await tx.put('imports', operation_id, op)
        return op

    async def install_from_market(self, operation_id, *, repository, slug, workspace_id, target_id, publish):
        market_id = market_identity(repository, slug)
        market = {'id': market_id, 'workspace_id': workspace_id, 'target_id': target_id}
        url = 'https://github.com/' + repository.lower()
        op = await self.create_import(operation_id, kind='github', url=url, market=market)
        if op['stage'] != 'ready':
            return op
        options = [c for c in op['candidates'] if slug in (c['name'], Path(c['path']).name)]
        if len(options) != 1:
            raise SkillError('仓库中无法唯一定位此 Skill，请打开仓库核对', 409)
        candidate = options[0]
        if candidate['warnings']:
            raise SkillError('该 Skill 有未取得的包资源，请打开源仓库核对', 409)
        prefix = candidate['path'] + '/' if candidate['path'] else ''
        files = await asyncio.to_thread(self.storage.read_all, 'previews', op['id'])
        bundle = {p[len(prefix):]: raw for p, raw in files.items() if p.startswith(prefix)}
        if candidates(bundle, self.settings)[0]['version'] != candidate['version']:
            raise SkillError('待安装的 Skill 内容发生变化', 409)
        destination = await publish(workspace_id, target_id, candidate['name'], bundle)
        await self.refresh_catalog(workspace_id=workspace_id)
        async with self.repository.transaction() as tx:
            latest = await tx.get('imports', op['id'])
            if latest['stage'] == 'completed':
                return latest
            if latest['stage'] != 'ready':
                raise SkillError('安装操作已失效，请重新读取已安装列表', 409)
            entries = [e for e in await tx.all('skills') if self._in_scope(e, workspace_id)]
            entry = next((e for e in entries if e['version'] == candidate['version'] and any(
                v['source']['path'] == str(destination) for v in e.get('locations', [])
            )), None)
            if not entry:
                # 关闭 RayAgent 来源时不扫描该目录，文件仍已按确认的位置安装。
                config = await self._config()
                kind = 'workspace' if workspace_id else 'rayagent'
                sid = source_id_for(kind, NATIVE_RELATIVE, workspace_id=workspace_id)
                src = {'kind': kind, 'source_id': sid, 'group': 'rayagent', 'path': str(destination),
                       'canonical': str(destination), 'label': '工作区 · .rayagent/skills' if workspace_id else 'RayAgent 全局',
                       **({'workspace_id': workspace_id} if workspace_id else {})}
                if self._source_state(src, config) == 'enabled':
                    raise SkillError('文件已安装但登记尚未完成，请重试读取结果', 409)
                entry = await self._register_market_result(tx, src, candidate, bundle)
            entry = {**entry, 'market': {'id': market_id, 'commit': op['source']['commit']}}
            entry.pop('suppressed', None)
            await tx.put('skills', entry['id'], entry)
            row = self._present([entry], await self._config(), workspace_id)[0]
            result = {**latest, 'stage': 'completed', 'result': row, 'destination': str(destination)}
            await tx.put('imports', op['id'], result)
            return result

    async def _register_market_result(self, tx, source, candidate, bundle):
        version = candidate['version']
        await asyncio.to_thread(self.storage.write, 'versions', version, bundle)
        if not await tx.get('versions', version):
            metadata = {k: candidate[k] for k in ('name', 'description', 'version', 'files', 'warnings')}
            metadata['source'] = source
            metadata['context_chars'] = len(body_message(
                '', {**metadata, 'text': candidate['text']}, self.settings.skill_resource_chars)['content'])
            await tx.put('versions', version, metadata)
        skill_id = skill_id_for(source['kind'], source['canonical'], candidate['name'])
        old = await tx.get('skills', skill_id)
        return {
            **{k: candidate[k] for k in ('name', 'description', 'version')},
            'id': skill_id, 'enabled': bool(old.get('enabled', True)) if old else True,
            'included': self._is_included(old) if old else False, 'builtin': False, 'external': True,
            'status': 'available', 'source': source, 'locations': [{'source': source, 'status': 'available'}],
        }

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

    async def change(self, skill_id, expected_version, *, enabled=None, included=None, delete=False,
                     workspace_id=None):
        if enabled is None and included is None and not delete:
            raise SkillError('没有要修改的状态')
        config = await self._config()
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', skill_id)
            if not entry or not self._in_scope(entry, workspace_id):
                if delete:
                    return
                raise SkillError('Skill 不存在', 404)
            if entry['version'] != expected_version:
                raise SkillError('Skill 版本已变化，请刷新', 409)
            if delete:
                if entry.get('builtin'):
                    raise SkillError('内置 Skill 可以停用，不能删除', 409)
                if entry.get('external'):
                    # 保留移除标记，手动重扫时可以找回用户文件。
                    await tx.put('skills', skill_id, {**entry, 'suppressed': True})
                else:
                    await tx.delete('skills', skill_id)
                return
            if enabled is not None:
                entry = {**entry, 'enabled': enabled}
            if included is not None:
                if included and not entry.get('enabled'):
                    raise SkillError('停用的 Skill 不能纳入目录', 409)
                entry = {**entry, 'included': included}
            if entry.get('enabled') and self._is_included(entry):
                await self._check_budget(tx, entry, config)
            await tx.put('skills', skill_id, entry)
        return entry

    def _specs(self, config, folder, workspace_id):
        return convention_sources(workspace_folder=folder, workspace_id=workspace_id,
                                  global_folder=self.global_folder, config=config)

    async def sources(self, *, workspace_id: str | None = None) -> dict:
        config = await self._config()
        folder, wid = await self._locate_workspace(workspace_id)
        specs = self._specs(config, folder, wid)
        async with self.repository.transaction() as tx:
            entries = await tx.all('skills')
        counts: dict[str, int] = {}
        group_members: dict[str, set[str]] = {group: set() for group in GROUPS}
        for entry in entries:
            if self._in_scope(entry, workspace_id) and not entry.get('suppressed'):
                for item in entry.get('locations') or [{'source': entry.get('source') or {}}]:
                    if sid := item['source'].get('source_id'):
                        counts[sid] = counts.get(sid, 0) + 1
                        group = item['source'].get('group') or source_group(sid)
                        if group in group_members:
                            group_members[group].add(entry['id'])
        return {
            'config': config.model_dump(),
            'groups': [{'id': group, 'label': label, 'enabled': group not in config.disabled_groups,
                        'count': len(group_members[group])}
                       for group, label in GROUPS.items()],
            'sources': [
                {
                    'source_id': s.source_id, 'kind': s.kind, 'label': s.label, 'group': s.group,
                    'path': str(s.root), 'enabled': s.enabled, 'instance_enabled': s.instance_enabled,
                    'exists': s.root.is_dir(), 'workspace_id': s.workspace_id, 'count': counts.get(s.source_id, 0),
                    'problems': self._discovery.problems.get(s.source_id, []) if s.enabled else [],
                }
                for s in specs
            ],
        }

    async def refresh_catalog(self, *, workspace_id: str | None = None, session_id: str | None = None,
                              force: bool = False):
        """只核对当前范围，逐包更新快照。已绑定运行沿原版本。"""
        key = (workspace_id, session_id, force)
        pending = self._discovery.pending
        if key not in pending:
            async def scan():
                try:
                    await self._refresh_catalog(workspace_id, session_id, force)
                finally:
                    pending.pop(key, None)

            pending[key] = asyncio.create_task(scan())
        await asyncio.shield(pending[key])

    async def _refresh_catalog(self, workspace_id, session_id, force):
        async with self._discovery.lock:
            config = await self._config()
            folder, wid = await self._locate_workspace(workspace_id, session_id)
            other_roots = await self._workspace_roots() if self._workspace_roots else {}
            scans: dict[str, dict[str, dict]] = {}
            for spec in self._specs(config, folder, wid):
                if not spec.enabled:
                    continue
                results = await asyncio.to_thread(
                    discover_packages, spec, self.settings, self._discovery.cache,
                    publish=lambda version, bundle: self.storage.write('versions', version, bundle),
                    exists=lambda version: self.snapshot_root(version).is_dir(), force=force,
                    foreign_roots=tuple(Path(root) for key, root in other_roots.items() if key != spec.workspace_id),
                )
                self._discovery.problems[spec.source_id] = [
                    {'path': r['origin'], 'error': r['error']} for r in results if 'error' in r
                ][:20]
                scan = scans[spec.source_id] = {}
                for item in results:
                    if 'error' in item:
                        scan[item['origin']] = item
                        continue
                    item['source'] = {
                        'kind': spec.kind, 'label': spec.label, 'path': item['origin'],
                        'canonical': item['canonical'], 'source_id': spec.source_id, 'group': spec.group,
                        **({'workspace_id': spec.workspace_id} if spec.workspace_id else {}),
                    }
                    scan[item['origin']] = item
            await self._register_scan(scans, config, wid, bool(folder), force)

    async def _register_scan(self, scans, config, workspace_id, workspace_available, force):
        async with self.repository.transaction() as tx:
            entries = {e['id']: e for e in await tx.all('skills') if e.get('external')}
            seen: dict[str, list[dict]] = {}
            for scanned in scans.values():
                for item in scanned.values():
                    if 'id' in item:
                        seen.setdefault(item['id'], []).append(item)
            for skill_id in entries.keys() | seen.keys():
                old = entries.get(skill_id)
                fresh = seen.get(skill_id, [])
                if old and not fresh and not self._in_scope(old, workspace_id):
                    continue
                locations = {item['source']['source_id']: item for item in (old or {}).get('locations', [])}
                if old and not locations:
                    src = old['source']
                    locations[src['source_id']] = {'source': src, 'status': old.get('status', 'available')}
                for sid, location in list(locations.items()):
                    scan = scans.get(sid)
                    if scan is not None:
                        scanned = scan.get(location['source']['path'])
                        status = ('invalid' if (scanned and 'error' in scanned) or
                                  any(item.get('source_error') for item in scan.values()) else 'missing')
                    elif entry_kind(old or {}) == 'workspace' and workspace_id and not workspace_available:
                        status = 'missing'
                    else:
                        continue
                    locations[sid] = {**location, 'status': status}
                for item in fresh:
                    src = item['source']
                    locations[src['source_id']] = {'source': src, 'status': 'available'}
                current = (min(fresh, key=lambda item: item['source']['source_id']) if fresh else old)
                entry = {
                    **{k: current[k] for k in ('id', 'name', 'description', 'version', 'source')},
                    'enabled': bool(old.get('enabled', True)) if old else True,
                    'included': self._is_included(old) if old else False,
                    'builtin': False, 'external': True, 'status': 'available',
                    'locations': list(locations.values()),
                }
                if old and old.get('market') and old['version'] == entry['version']:
                    entry['market'] = old['market']
                if old and old.get('suppressed') and not (force and fresh):
                    entry['suppressed'] = True
                if fresh and not await tx.get('versions', entry['version']):
                    version = {k: current[k] for k in ('name', 'description', 'version', 'files', 'warnings', 'source')}
                    version['context_chars'] = len(body_message(
                        '', {**version, 'text': current['text']}, self.settings.skill_resource_chars)['content'])
                    await tx.put('versions', entry['version'], version)
                effective = self._effective_entry(entry, config)
                entry['status'] = effective['status']
                entry['source'] = effective['source']
                if entry != old:
                    await tx.put('skills', skill_id, entry)

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
            enabled = old['enabled'] if old else True
            included = bool(old['included']) if old and 'included' in old else True
            entry = {k: candidate[k] for k in ('name', 'description', 'version')}
            entry.update(id=candidate['name'], enabled=enabled, included=included, builtin=True,
                         external=False, status='available', source={'kind': 'builtin', 'label': '内置'})
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

    def _validate_entry(self, entry, version, workspace_id, config):
        if entry and not entry.get('suppressed') and self._in_scope(entry, workspace_id):
            candidate = self._effective_entry(entry, config)
            if candidate['version'] == version and self._selectable(candidate, config):
                return candidate
        raise SkillError('所选 Skill 不可用或版本已变化，请刷新选择。草稿已保留', 409)

    async def validate_selection(self, selection, *, workspace_id=None):
        if not selection:
            return
        skill_id = selection['id'] if isinstance(selection, dict) else selection.id
        version = selection['version'] if isinstance(selection, dict) else selection.version
        config = await self._config()
        async with self.repository.transaction() as tx:
            self._validate_entry(await tx.get('skills', skill_id), version, workspace_id, config)

    async def accept(self, uow, session_id, selection):
        """在消息与运行的同一受理事务中校验选择、固定目录和登记版本引用。"""
        tx = uow.skills
        await tx.lock()
        run = await uow.run.get_active(session_id)
        if run is None:
            raise SkillError('活动运行不存在', 409)
        session = await uow.session.get_by_id(session_id)
        workspace_id = getattr(session, 'workspace_id', None) if session else None
        if run.config_snapshot.get('skills_frozen'):
            bound = await self._scoped_bindings(tx, run.id, workspace_id)
        else:
            entries = await tx.all('skills')
            config = await self._config()
            selected = None
            if selection:
                selected = self._validate_entry(
                    next((e for e in entries if e['id'] == selection.id), None),
                    selection.version, workspace_id, config,
                )
            bound = self._freeze_bound(entries, config, workspace_id, selected)
            for entry in bound:
                payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
                await tx.bind(run.id, entry['id'], entry['version'], payload)
            await uow.run.save_snapshot(run.id, {**run.config_snapshot, 'skills_frozen': True,
                                                 'skill_workspace_id': workspace_id})
        if selection and not any(e['id'] == selection.id and e['version'] == selection.version for e in bound):
            raise SkillError('本运行目录已经固定，请在新运行选择此 Skill 版本', 409)

    async def _scoped_bindings(self, tx, run_id, workspace_id):
        return [e for e in await tx.bindings(run_id) if self._in_scope(e, workspace_id)]

    async def bind_run(self, run_id, *, workspace_id: str | None = None, session_id: str | None = None):
        await self.refresh_catalog(workspace_id=workspace_id, session_id=session_id)
        config = await self._config()
        async with self.repository.transaction(run_id=run_id) as tx:
            from_snapshot = await self._scoped_bindings(tx, run_id, workspace_id)
            if from_snapshot:
                return from_snapshot
            entries = self._freeze_bound(await tx.all('skills'), config, workspace_id, None)
            bound = []
            for entry in entries:
                payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
                await tx.bind(run_id, entry['id'], entry['version'], payload)
                bound.append(payload)
            return bound

    async def bindings(self, run_id, *, workspace_id=None):
        async with self.repository.transaction() as tx:
            return await self._scoped_bindings(tx, run_id, workspace_id)

    async def append(self, run_id, entry, *, workspace_id=None):
        config = await self._config()
        async with self.repository.transaction(run_id=run_id) as tx:
            latest = await tx.get('skills', entry['id'])
            entry = self._validate_entry(latest, entry['version'], workspace_id, config)
            bound = await self._scoped_bindings(tx, run_id, workspace_id)
            old = next((b for b in bound if b['id'] == entry['id'] or b['name'] == entry['name']), None)
            if old:
                if old['version'] != entry['version']:
                    raise SkillError('本运行已固定同名旧版本，新版本在新运行生效', 409)
                return old
            if len(catalog_message('', [*bound, entry], self.settings.skill_catalog_description_chars)['content']) > self.settings.skill_catalog_chars:
                raise SkillError('本运行 Skill 目录容量不足', 409)
            payload = {**entry, 'active': False, 'root_path': str(self.snapshot_root(entry['version']))}
            await tx.bind(run_id, entry['id'], entry['version'], payload)
        return payload

    def _find_bound(self, bound, name_or_id):
        match = next((e for e in bound if e['id'] == name_or_id), None)
        if match:
            return match
        matches = [e for e in bound if e['name'] == name_or_id]
        if len(matches) > 1:
            raise SkillError('本运行绑定了多个同名 Skill，请使用明确身份或开始新运行', 409)
        return matches[0] if matches else None

    async def load(self, run_id, name, *, workspace_id=None):
        async with self.repository.transaction() as tx:
            bound = await self._scoped_bindings(tx, run_id, workspace_id)
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
            return {**version, 'source': entry['source'], 'text': parsed['text'], 'root_path': root_path}
        async with self.repository.transaction() as tx:
            current = await self._scoped_bindings(tx, run_id, workspace_id)
            total = 0
            for item in current:
                if item['active'] or item['id'] == entry['id']:
                    v = await tx.get('versions', item['version'])
                    total += v.get('context_chars', self.settings.skill_body_chars + self.settings.skill_resource_chars + 2048)
            if total > self.settings.skill_active_chars:
                raise SkillError('活动 Skill 正文容量不足，请在新运行减少加载的 Skill', 409)
            await tx.bind(run_id, entry['id'], entry['version'], {**entry, 'active': True, 'root_path': root_path})
        return {**version, 'source': entry['source'], 'text': parsed['text'], 'root_path': root_path}

    async def resource(self, run_id, name, path, start_line=1, end_line=None, *, workspace_id=None):
        entries = await self.bindings(run_id, workspace_id=workspace_id)
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

    async def mark_prepared(self, run_id, name, *, workspace_id=None):
        async with self.repository.transaction() as tx:
            entry = self._find_bound(await self._scoped_bindings(tx, run_id, workspace_id), name)
            if not entry or not entry['active']:
                raise SkillError('材料准备没有对应的活动 Skill', 409)
            await tx.bind(run_id, entry['id'], entry['version'], {**entry, 'prepared': True})

    async def cancel_run(self, run_id):
        async with self.repository.transaction() as tx:
            for op in await tx.all('imports'):
                if op.get('owner') == run_id and op['stage'] in ('fetching', 'validating', 'ready'):
                    await tx.put('imports', op['id'], {**op, 'stage': 'cancelled', 'error': '运行已停止'})
