"""skill 管理与运行绑定协调；所有入口共享此服务。"""
import asyncio
import hashlib
import json
import time
import uuid
from pathlib import Path

from app.domain.repositories.skills import SkillRepository
from app.domain.services.skill_context import catalog_message, body_message
from app.domain.services.skill_packages import SkillError, candidates, parse_skill, safe_path, unzip


class SkillService:
    def __init__(self, repository: SkillRepository, storage, github, settings):
        self.repository, self.storage, self.github, self.settings = repository, storage, github, settings

    async def list(self):
        async with self.repository.transaction() as tx:
            return sorted(await tx.all('skills'), key=lambda r: r['name'])

    async def detail(self, name):
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', name)
            version = await tx.get('versions', entry['version']) if entry else None
        if not entry or not version:
            raise SkillError('Skill 不存在', 404)
        raw = await asyncio.to_thread(self.storage.read, version['version'], version['files'], 'SKILL.md')
        return {**version, **entry, 'text': raw.decode('utf-8-sig')}

    async def operation(self, operation_id):
        async with self.repository.transaction() as tx:
            op = await tx.get('imports', operation_id)
        if not op:
            raise SkillError('导入操作不存在', 404)
        return op

    async def create_import(self, operation_id, *, kind, url=None, raw=None, text=None, update_name=None, expected_version=None, owner=None, tool_call_id=None):
        try:
            operation_id = uuid.UUID(operation_id).hex
        except (ValueError, TypeError):
            raise SkillError('需要有效的导入操作 ID')
        if kind not in ('github', 'zip', 'manual'):
            raise SkillError('不支持的来源')
        if kind == 'github' and not url:
            raise SkillError('请提供公开 GitHub 地址')
        if kind == 'zip' and not raw:
            raise SkillError('请选择非空 ZIP 包')
        content = raw if kind == 'zip' else (url if kind == 'github' else text or '').encode()
        fingerprint = hashlib.sha256(content + json.dumps([kind, update_name, expected_version, owner]).encode()).hexdigest()
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

    async def _check_budget(self, tx, replacement=None, remove=None):
        entries = {e['name']: e for e in await tx.all('skills')}
        if replacement:
            entries[replacement['name']] = replacement
        if remove:
            entries.pop(remove, None)
        size = len(catalog_message('', [e for e in entries.values() if e['enabled']])['content'])
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
        # 文件先发布；数据库失败留下可识别孤立包，不暴露条目。
        await asyncio.to_thread(self.storage.write, 'versions', fingerprint, bundle)
        name = candidate['name']
        version = {**candidate, 'source': {**op['source'], 'path': candidate_path}}
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
            existing = await tx.get('skills', name)
            if existing and existing.get('builtin'):
                raise SkillError('同名内置 Skill 只能由应用升级更新', 409)
            if op['update_name']:
                if name != op['update_name'] or not existing or existing['version'] != op['expected_version']:
                    raise SkillError('Skill 已更新或名称改变，请刷新后重试', 409)
            elif existing and existing['version'] != fingerprint:
                raise SkillError('同名 Skill 内容不同，请使用更新入口', 409)
            entry = existing if existing and existing['version'] == fingerprint else {
                'id': name, 'name': name, 'description': candidate['description'], 'version': fingerprint,
                'enabled': existing['enabled'] if existing else True, 'builtin': False, 'source': version['source']}
            await self._check_budget(tx, entry)
            # 回收器也持有目录锁：再次核对发布目录，覆盖首次发布与提交间的孤立包回收竞争。
            await asyncio.to_thread(self.storage.write, 'versions', fingerprint, bundle)
            if not await tx.get('versions', fingerprint):
                await tx.put('versions', fingerprint, version)
            await tx.put('skills', name, entry)
            op = {**current_op, 'stage': 'completed', 'result': entry, 'selected_path': candidate_path, 'selected_version': fingerprint}
            await tx.put('imports', operation_id, op)
        return op

    async def edit(self, name, expected_version, text):
        detail = await self.detail(name)
        if detail['builtin']:
            raise SkillError('内置 Skill 由应用升级更新', 409)
        files = {f['path']: await asyncio.to_thread(self.storage.read, detail['version'], detail['files'], f['path']) for f in detail['files']}
        files['SKILL.md'] = text.encode()
        import io, zipfile
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for path, data in files.items():
                archive.writestr(path, data)
        op = await self.create_import(uuid.uuid4().hex, kind='zip', raw=buffer.getvalue(), update_name=name, expected_version=expected_version)
        async with self.repository.transaction() as tx:
            op = {**(await tx.get('imports', op['id'])), 'source': {**detail['source'], 'edited': True}}
            await tx.put('imports', op['id'], op)
        return await self.publish(op['id'], op['candidates'][0]['path'], op['candidates'][0]['version'])

    async def change(self, name, expected_version, *, enabled=None, delete=False):
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', name)
            if not entry:
                if delete:
                    return
                raise SkillError('Skill 不存在', 404)
            if entry['version'] != expected_version:
                raise SkillError('Skill 版本已变化，请刷新', 409)
            if delete:
                if entry['builtin']:
                    raise SkillError('内置 Skill 可以停用，不能删除', 409)
                await tx.delete('skills', name)
            else:
                entry = {**entry, 'enabled': enabled}
                await self._check_budget(tx, entry)
                await tx.put('skills', name, entry)
        return entry

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
            if old and not old.get('builtin'):
                raise SkillError('内置 find-skills 与用户 Skill 同名，请先更名用户 Skill', 409)
            version = {**candidate, 'source': {'kind': 'builtin'}}
            version['context_chars'] = len(body_message('', version, self.settings.skill_resource_chars)['content'])
            version.pop('text', None)
            entry = {k: candidate[k] for k in ('name', 'description', 'version')}
            entry.update(id=candidate['name'], enabled=old['enabled'] if old else True, builtin=True, source={'kind': 'builtin'})
            await self._check_budget(tx, entry)
            await tx.put('versions', candidate['version'], version)
            await tx.put('skills', candidate['name'], entry)
        await self.collect()

    async def collect(self):
        # 与发布共用数据库锁，避免删除“文件已发布、尚未登记”的新包；只回收过期包。
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
        async with self.repository.transaction() as tx:
            entry = await tx.get('skills', selection['id'])
        if not entry or not entry['enabled'] or entry['version'] != selection['version']:
            raise SkillError('所选 Skill 已删除、停用或更新，请刷新选择；草稿已保留', 409)

    async def accept(self, uow, session_id, selection):
        """在消息与运行的同一受理事务中校验选择、固定目录和登记版本引用。"""
        tx = uow.skills
        await tx.lock()
        run = await uow.run.get_active(session_id)
        if run is None:
            raise SkillError('活动运行不存在', 409)
        entries = await tx.all('skills')
        selected = next((e for e in entries if selection and e['name'] == selection.id), None)
        if selection and (not selected or not selected['enabled'] or selected['version'] != selection.version):
            raise SkillError('所选 Skill 已删除、停用或更新，请刷新选择', 409)
        if not run.config_snapshot.get('skills_frozen'):
            bound = [e for e in entries if e['enabled']]
            for entry in bound:
                await tx.bind(run.id, entry['name'], entry['version'], {**entry, 'active': False})
            await uow.run.save_snapshot(run.id, {**run.config_snapshot, 'skills_frozen': True})
        else:
            bound = await tx.bindings(run.id)
        if selection and not any(e['name'] == selection.id and e['version'] == selection.version for e in bound):
            raise SkillError('本运行目录已经固定，请在新运行选择此 Skill 版本', 409)

    async def bind_run(self, run_id):
        async with self.repository.transaction(run_id=run_id) as tx:
            from_snapshot = await tx.bindings(run_id)
            if from_snapshot:
                return from_snapshot
            # 空目录也必须冻结；由运行快照标志处理，首次至少含内置 skill 或空标志。
            entries = [e for e in await tx.all('skills') if e['enabled']]
            for entry in entries:
                await tx.bind(run_id, entry['name'], entry['version'], {**entry, 'active': False})
            return [{**e, 'active': False} for e in entries]

    async def bindings(self, run_id):
        async with self.repository.transaction() as tx:
            return await tx.bindings(run_id)

    async def append(self, run_id, entry):
        async with self.repository.transaction(run_id=run_id) as tx:
            latest = await tx.get('skills', entry['name'])
            if not latest or not latest['enabled'] or latest['version'] != entry['version']:
                raise SkillError('安装结果已被删除、停用或更新，未追加本运行目录', 409)
            bound = await tx.bindings(run_id)
            old = next((b for b in bound if b['name'] == entry['name']), None)
            if old:
                if old['version'] != entry['version']:
                    raise SkillError('本运行已固定同名旧版本，新版本在新运行生效', 409)
                return old
            if len(catalog_message('', [*bound, entry])['content']) > self.settings.skill_catalog_chars:
                raise SkillError('本运行 Skill 目录容量不足', 409)
            await tx.bind(run_id, entry['name'], entry['version'], {**entry, 'active': False})
        return {**entry, 'active': False}

    async def load(self, run_id, name):
        async with self.repository.transaction() as tx:
            bound = await tx.bindings(run_id)
            entry = next((e for e in bound if e['name'] == name), None)
            if not entry:
                raise SkillError('Skill 不在本运行启用目录中', 404)
            version = await tx.get('versions', entry['version'])
            if not version:
                raise SkillError('绑定版本缺失，请重新导入', 409)
        raw = await asyncio.to_thread(self.storage.read, entry['version'], version['files'], 'SKILL.md')
        parsed = parse_skill(raw, self.settings)
        if entry['active']:
            return {**version, 'text': parsed['text']}
        async with self.repository.transaction() as tx:
            current = await tx.bindings(run_id)
            total = 0
            for item in current:
                if item['active'] or item['name'] == name:
                    v = await tx.get('versions', item['version'])
                    total += v.get('context_chars', self.settings.skill_body_chars + self.settings.skill_resource_chars + 2048)
            if total > self.settings.skill_active_chars:
                raise SkillError('活动 Skill 正文容量不足，请在新运行减少加载的 Skill', 409)
            await tx.bind(run_id, name, entry['version'], {**entry, 'active': True})
        return {**version, 'text': parsed['text']}

    async def resource(self, run_id, name, path, start_line=1, end_line=None):
        entries = await self.bindings(run_id)
        entry = next((e for e in entries if e['name'] == name and e['active']), None)
        if not entry:
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
            entry = next((e for e in await tx.bindings(run_id) if e['name'] == name), None)
            if not entry or not entry['active']:
                raise SkillError('材料准备没有对应的活动 Skill', 409)
            await tx.bind(run_id, name, entry['version'], {**entry, 'prepared': True})

    async def cancel_run(self, run_id):
        async with self.repository.transaction() as tx:
            for op in await tx.all('imports'):
                if op.get('owner') == run_id and op['stage'] in ('fetching', 'validating', 'ready'):
                    await tx.put('imports', op['id'], {**op, 'stage': 'cancelled', 'error': '运行已停止'})
