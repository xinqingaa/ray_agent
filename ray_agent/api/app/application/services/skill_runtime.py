"""单运行 skill 端口，与目录、正文和快照材料的版本绑定。"""
import asyncio
import uuid
from pathlib import Path

from app.domain.models.tool_result import ToolResult
from app.domain.services.skill_packages import SkillError
from app.domain.services.skill_context import catalog_message, body_message


class SkillRuntime:
    def __init__(self, service, run_id, *, workdir=None, workspace_id=None, session_id=None):
        self.service, self.run_id = service, run_id
        self.workdir = workdir
        self.workspace_id = workspace_id
        self.session_id = session_id
        self.entries = []
        # 兼容旧工具探测：本地快照映射可用时视为“有执行材料环境”
        self.sandbox = self

    async def initialize(self, frozen=False):
        if frozen:
            self.entries = await self.service.bindings(self.run_id)
            for entry in self.entries:
                if entry.get("prepared"):
                    result = await self.prepare(entry["name"])
                    if not result.success:
                        raise SkillError("等待续接的 Skill 材料恢复失败：" + (result.message or "未知错误"), 409)
        else:
            self.entries = await self.service.bind_run(
                self.run_id, workspace_id=self.workspace_id, session_id=self.session_id)

    async def load(self, name):
        try:
            version = await self.service.load(self.run_id, name)
            return ToolResult(success=True, message='完整正文已激活，将作为 Skill 资料提供；不表示任务已完成',
                              data={'name': name, 'version': version['version'], 'active': True,
                                    'root_path': version.get('root_path')})
        except SkillError as exc:
            return ToolResult(success=False, message=str(exc))

    async def resource(self, name, path, start, end):
        try:
            return ToolResult(success=True, data=await self.service.resource(self.run_id, name, path, start, end))
        except SkillError as exc:
            return ToolResult(success=False, message=str(exc))

    async def prepare_skill_resources(self, run_id, name, version, payload=None):
        """兼容旧 sandbox 接口名：返回已发布快照的稳定根路径。"""
        return await self.prepare(name)

    async def prepare(self, name):
        """本机执行直接映射已发布快照；不复制、不安装依赖、不执行包管理器。"""
        try:
            entries = await self.service.bindings(self.run_id)
            entry = next((e for e in entries if (e['name'] == name or e['id'] == name) and e.get('active')), None)
            if not entry:
                raise SkillError('请先加载 Skill')
            root = Path(entry.get('root_path') or self.service.snapshot_root(entry['version']))
            if not root.is_dir():
                raise SkillError('Skill 快照缺失，无法准备材料；请重新发现或导入', 409)
            # 核对清单完整性
            async with self.service.repository.transaction() as tx:
                version = await tx.get('versions', entry['version'])
            missing = []
            for item in version['files']:
                target = root / item['path']
                if not target.is_file():
                    missing.append(item['path'])
            if missing:
                raise SkillError('Skill 快照不完整：' + ', '.join(missing[:5]), 409)
            await self.service.mark_prepared(self.run_id, name)
            return ToolResult(
                success=True,
                message='已映射到运行绑定的 Skill 快照根路径；脚本工作目录请使用工作区或会话目录，不要回写包内文件。不自动安装依赖。',
                data={'name': name, 'version': entry['version'], 'root_path': str(root), 'files': len(version['files'])},
            )
        except SkillError as exc:
            return ToolResult(success=False, message=str(exc))

    async def install(self, url, candidate_path, operation_id, use_now, request_id=None):
        try:
            operation_id = uuid.UUID(operation_id).hex if operation_id else uuid.uuid5(uuid.NAMESPACE_URL, self.run_id + ':' + (request_id or url + ':' + str(candidate_path))).hex
            if operation_id:
                try:
                    op = await self.service.operation(operation_id)
                    if op['owner'] != self.run_id or op['source'].get('url') != url:
                        raise SkillError('操作与当前运行或来源不匹配')
                except SkillError as exc:
                    if exc.status != 404:
                        raise
                    op = await self.service.create_import(operation_id, kind='github', url=url, owner=self.run_id, tool_call_id=request_id)
            if op['stage'] == 'ready':
                found = op['candidates']
                choice = next((c for c in found if c['path'] == candidate_path), None) if candidate_path is not None else found[0] if len(found) == 1 else None
                if choice is None and candidate_path is not None:
                    raise SkillError('候选不属于该导入操作，请按返回目录选择')
                if choice is None:
                    return ToolResult(success=True, message='请选择候选后携带同一 operation_id 续接，尚未安装', data={
                        'operation_id': op['id'], 'candidates': [{k: c[k] for k in ('path', 'name', 'description', 'version', 'warnings')} for c in found]})
                op = await self.service.publish(op['id'], choice['path'], choice['version'], owner=self.run_id)
            if op['stage'] != 'completed':
                return ToolResult(success=False, message=op.get('error') or '导入仍在处理中，请查询同一操作', data={'operation_id': op['id'], 'stage': op['stage']})
            if candidate_path is not None and op.get('selected_path') != candidate_path:
                raise SkillError('导入操作已用于其他候选，请发起新的安装操作', 409)
            entry = op['result']
            latest = next((e for e in await self.service.list(refresh=False) if e['id'] == entry['id']), None)
            if not latest or not latest['enabled'] or latest['version'] != entry['version']:
                return ToolResult(success=True, message='该导入操作曾完成，但 Skill 当前已删除、停用或更新；未追加本运行。请核对设置或发起新的安装操作。',
                    data={'operation_id': op['id'], 'historical_result': entry, 'current': latest, 'available_this_run': False})
            append_error = None
            if use_now:
                try:
                    await self.service.append(self.run_id, entry)
                    self.entries = await self.service.bindings(self.run_id)
                except SkillError as exc:
                    append_error = str(exc)
            return ToolResult(success=True, message='Skill 已安装；需要使用时调用 load_skill。安装不代表执行环境或任务成果已验证。',
                              data={'operation_id': op['id'], **entry, 'available_this_run': use_now and not append_error, 'use_error': append_error})
        except (SkillError, ValueError) as exc:
            return ToolResult(success=False, message=str(exc), data={'operation_id': operation_id})

    async def context(self):
        self.entries = sorted(await self.service.bindings(self.run_id), key=lambda e: e['name'])
        blocks = [catalog_message(self.run_id, self.entries)]
        for entry in self.entries:
            if entry['active']:
                version = await self.service.load(self.run_id, entry['name'])
                blocks.append(body_message(self.run_id, version, self.service.settings.skill_resource_chars))
        return blocks
