"""单运行 skill 端口，与目录、正文和沙箱材料的版本绑定。"""
import asyncio
import base64
import uuid
from app.domain.models.tool_result import ToolResult
from app.domain.services.skill_packages import SkillError


from app.domain.services.skill_context import catalog_message, body_message


class SkillRuntime:
    def __init__(self, service, run_id, sandbox):
        self.service, self.run_id, self.sandbox = service, run_id, sandbox
        self.entries = []

    async def initialize(self, frozen=False):
        self.entries = await (self.service.bindings(self.run_id) if frozen else self.service.bind_run(self.run_id))
        if frozen:
            for entry in self.entries:
                if entry.get("prepared"):
                    result = await self.prepare(entry["name"])
                    if not result.success:
                        raise SkillError("等待续接的 Skill 材料恢复失败：" + (result.message or "未知错误"), 409)

    async def load(self, name):
        try:
            version = await self.service.load(self.run_id, name)
            # 正文以内部类型资料块进入下一次请求，不伪造工具调用，也不经通用结果截断。
            return ToolResult(success=True, message='完整正文已激活，将作为 Skill 资料提供；不表示任务已完成',
                              data={'name': name, 'version': version['version'], 'active': True})
        except SkillError as exc:
            return ToolResult(success=False, message=str(exc))

    async def resource(self, name, path, start, end):
        try:
            return ToolResult(success=True, data=await self.service.resource(self.run_id, name, path, start, end))
        except SkillError as exc:
            return ToolResult(success=False, message=str(exc))

    async def prepare(self, name):
        try:
            entries = await self.service.bindings(self.run_id)
            entry = next((e for e in entries if e['name'] == name and e['active']), None)
            if not entry:
                raise SkillError('请先加载 Skill')
            async with self.service.repository.transaction() as tx:
                version = await tx.get('versions', entry['version'])
            payload = []
            for item in version['files']:
                raw = await asyncio.to_thread(self.service.storage.read, entry['version'], version['files'], item['path'])
                payload.append({**item, 'content': base64.b64encode(raw).decode()})
            result = await self.sandbox.prepare_skill_resources(self.run_id, name, entry['version'], payload)
            if result.success:
                await self.service.mark_prepared(self.run_id, name)
            return result
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
            latest = next((e for e in await self.service.list() if e['name'] == entry['name']), None)
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
