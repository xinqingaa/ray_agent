"""成果版本、实际核验与受限收尾；业务正确性不由工具 success 推断。"""
import hashlib
import json
from pathlib import PurePosixPath
from typing import Optional
from app.domain.models.event import PlanEvent
from app.domain.models.plan import Verification
from app.domain.models.tool_result import ToolResult
from app.domain.services.tools.base import BaseTool, tool

VERIFICATION_SCHEMA = {"type": "object", "description": "仅对必要核验或针对性修复登记；复用同版本同条件通过证据，不增加独立核对调用。核验脚本返回 JSON passed 布尔值及简短说明。", "properties": {
    "key": {"type": "string"}, "artifact_id": {"type": "string"}, "condition": {"type": "string"},
    "purpose": {"type": "string", "enum": ["verify", "repair"]},
    "repeat_reason": {"type": "string", "description": "已有通过或连续两次失败后再次执行的具体新条件或换方法原因"},
}, "required": ["key", "artifact_id", "condition", "purpose"]}
VERIFICATION_TOOLS = {"shell_execute", "browser_console_exec", "read_file", "write_file", "replace_in_file"}


class TaskOutcomes:
    def __init__(self, plan_tool, sandbox):
        self.plan_tool, self.sandbox = plan_tool, sandbox
        self.frozen_ids = None

    def artifact(self, aid):
        plan = self.plan_tool.latest_plan
        return next((a for a in plan.artifacts if a.id == aid), None) if plan else None

    async def fingerprint(self, path):
        if not path or self.sandbox is None: return None
        stream = None
        try:
            stream = await self.sandbox.download_file(path)
            digest = hashlib.sha256()
            while chunk := stream.read(65536): digest.update(chunk)
            return digest.hexdigest()
        except Exception:
            return None
        finally:
            if stream is not None: stream.close()

    async def existing_delivery(self, path):
        from app.domain.models.file import File
        from app.domain.services.tools.deliver import DeliveredFile
        plan = self.plan_tool.latest_plan
        if not plan: return None
        for a in plan.artifacts:
            if a.path != path or not a.delivered_file or a.state != 'delivered': continue
            actual = await self.fingerprint(path)
            if actual and actual == a.delivered_version:
                return DeliveredFile(file=File.model_validate(a.delivered_file), project=a.delivery_project)
        return None

    def freeze(self, scope=None):
        self.frozen_ids = {a.id for a in self.plan_tool.latest_plan.artifacts} if self.plan_tool.latest_plan else set()
        if self.plan_tool.latest_plan:
            for a in self.plan_tool.latest_plan.artifacts:
                if a.final_scope != scope:
                    a.final_scope, a.final_writes, a.final_attempts = scope, 0, 0
                    if a.path:
                        path = PurePosixPath(a.path)
                        suffix = hashlib.sha256(str(scope).encode()).hexdigest()[:8]
                        a.final_path = str(path.with_name(path.stem + '.final-' + suffix + path.suffix))

    def event(self):
        return PlanEvent(plan=self.plan_tool.latest_plan.model_copy(deep=True), review_only=True)

    async def before(self, invocation):
        meta = invocation.verification
        if not meta: return None
        if not isinstance(meta, dict) or any(not isinstance(meta.get(k), str) or not meta[k].strip() for k in ('key', 'artifact_id', 'condition')) or meta.get('purpose') not in ('verify','repair'):
            return ToolResult(success=False, message="verification 需要 key、artifact_id、condition 和 purpose=verify/repair")
        if meta.get('repeat_reason') is not None and not isinstance(meta['repeat_reason'], str):
            return ToolResult(success=False, message="repeat_reason 需要文字说明")
        meta['repeat_reason'] = (meta.get('repeat_reason') or '').strip()
        artifact = self.artifact(meta['artifact_id'])
        if invocation.function_name in ('write_file','replace_in_file') and meta['purpose'] == 'verify':
            return ToolResult(success=False, message='写操作只能登记 repair；核验需实际读取或执行检查')
        if not artifact: return ToolResult(success=False, message="verification 引用不存在的成果 id")
        version = await self.fingerprint(artifact.path)
        invocation.verified_version = version
        if artifact.version != version:
            artifact.version = version
            artifact.state = 'generated' if version else 'pending'
            for c in self.plan_tool.latest_plan.verifications:
                if c.artifact_id == artifact.id and c.version != version: c.state = 'stale'
            invocation.events.append(self.event())
        # 未取得实际版本时执行，但不复用或声明版本一致。
        records = self.plan_tool.latest_plan.verifications
        prior = next((c for c in reversed(records) if c.key == meta['key'] and c.artifact_id == artifact.id), None)
        if prior and not meta.get('repeat_reason'):
            if meta['purpose'] == 'verify' and prior.state == 'passed' and version and prior.version == version and prior.condition == meta['condition']:
                invocation.denied_by = 'verification_cache'
                return ToolResult(message="复用同版本、同条件的已通过证据；本次未重新执行", data={"executed": False, "reused": True, "evidence_call_id": prior.call_id, "version": version})
            if prior.attempts >= 2 and prior.state != 'passed':
                repaired = (meta['purpose'] == 'verify' and prior.state == 'executed' and prior.note
                            and version and prior.version != version)
                if not repaired:
                    invocation.denied_by = 'verification_limit'
                    return ToolResult(success=False, message="同一问题两次核验仍失败；先定位原因、换方法或说明受阻。新条件或新方法用 repeat_reason 说明", data={"executed": False})
        return None

    @staticmethod
    def passed(result):
        data = result.data
        if isinstance(data, dict):
            if data.get('status') == 'running': return None
            if data.get('returncode') not in (None, 0): return False
        if not result.success: return False
        if isinstance(data, dict):
            candidates = [data, data.get('result')]
            for key in ('output', 'stdout', 'content', 'result'):
                value = data.get(key)
                if isinstance(value, str):
                    try: candidates.append(json.loads(value))
                    except ValueError: pass
            for report in candidates:
                if isinstance(report, dict) and type(report.get('passed')) is bool:
                    return report['passed']
        return None

    async def after(self, invocation, result):
        plan = self.plan_tool.latest_plan
        if not plan or invocation.short_circuited: return result
        changed = False
        repairing = invocation.verification and invocation.verification.get('purpose') == 'repair'
        if invocation.function_name in ('write_file','replace_in_file','finalize_artifact') or repairing:
            path = invocation.arguments.get('filepath')
            if repairing:
                target = self.artifact(invocation.verification['artifact_id'])
                path = target.path if target else None
            if invocation.function_name == 'finalize_artifact':
                artifact = self.artifact(invocation.arguments.get('artifact_id'))
                path = artifact.path if artifact else None
            for artifact in plan.artifacts:
                if artifact.path == path:
                    version = await self.fingerprint(path)
                    if artifact.version != version:
                        artifact.version = version
                        artifact.state = 'generated' if version else 'pending'
                        for c in plan.verifications:
                            if c.artifact_id == artifact.id: c.state = 'stale'
                    changed = True
        meta = invocation.verification
        if meta:
            artifact = self.artifact(meta['artifact_id'])
            if artifact:
                prior = next((c for c in reversed(plan.verifications) if c.key == meta['key'] and c.artifact_id == artifact.id), None)
                passed = self.passed(result) if meta['purpose'] == 'verify' else None
                state = 'passed' if passed is True else 'failed' if passed is False else 'executed'
                attempts = (prior.attempts if prior else 0) + 1 if state == 'failed' else (prior.attempts if prior and meta['purpose'] == 'repair' else 0)
                record = Verification(key=meta['key'], artifact_id=artifact.id, condition=meta['condition'],
                    version=invocation.verified_version, call_id=invocation.call_id, state=state,
                    attempts=attempts, note=meta.get('repeat_reason') or '')
                if prior: plan.verifications.remove(prior)
                plan.verifications.append(record)
                if isinstance(result.data, dict):
                    result.data['_ray_verification'] = {'state': state, 'condition': record.condition}
                changed = True
        if invocation.function_name == 'finalize_artifact' and not result.success:
            a = self.artifact(invocation.arguments.get('artifact_id'))
            if a: a.state, a.error, changed = 'failed', result.message, True
        if invocation.function_name == 'deliver_files':
            items = getattr(result.data, 'items', [])
            for item in items:
                for artifact in plan.artifacts:
                    if artifact.path != item.path:
                        if not item.success or not artifact.final_attempts or artifact.final_path != item.path:
                            continue
                        # 写入结果未知时可先读回预留路径，再交付已确认存在的新版本。
                        artifact.path = item.path
                    version = await self.fingerprint(item.path)
                    artifact.version = version
                    for check in plan.verifications:
                        if check.artifact_id == artifact.id and check.version != version:
                            check.state = 'stale'
                    if item.success:
                        artifact.delivered_version = version
                        artifact.file_id = item.file.id
                        artifact.delivered_file = item.file.model_dump()
                        artifact.delivery_project = item.project
                    if item.success and not (item.project and item.project.get('state') == 'failed'):
                        artifact.state, artifact.error = 'delivered', None
                    else: artifact.state, artifact.error = 'failed', item.error or '项目副本未保存'
                    changed = True
        if changed: invocation.events.append(self.event())
        return result

    def failed_checks(self):
        plan = self.plan_tool.latest_plan
        if not plan:
            return []
        required = {a.id: a for a in plan.artifacts if a.required and a.schedule == 'current'}
        return [c for c in plan.verifications if c.state == 'failed' and c.artifact_id in required
                and c.version == required[c.artifact_id].version]

    def context(self):
        plan = self.plan_tool.latest_plan
        if not plan: return None
        return {"plan_id": plan.id, "goal": plan.goal, "scope": plan.scope,
                "current_user_seq": self.plan_tool.current_user_seq,
                "stages": [{"id": s.id, "stage": s.description, "status": s.status.value, "schedule": s.schedule, "reason": s.reason} for s in plan.stages],
                "steps": [{"id": s.id, "parent_id": s.parent_id, "step": s.description, "status": s.status.value, "schedule": s.schedule, "reason": s.reason} for s in plan.steps if s.kind == "step"],
                "artifacts": [{"id": a.id, "name": a.name, "path": a.path, "delivery": a.delivery, "schedule": a.schedule, "required": a.required, "state": a.state, "version": a.version, "delivered_version": a.delivered_version, "error": a.error,
                               "final_path": a.final_path, "final_attempts": a.final_attempts} for a in plan.artifacts],
                "checks": [c.model_dump() for c in plan.verifications]}

    def reply_delivered(self, content):
        plan = self.plan_tool.latest_plan
        if not plan or not content.strip():
            return None
        changed = False
        for artifact in plan.artifacts:
            if artifact.delivery == 'reply' and artifact.schedule == 'current':
                artifact.version = hashlib.sha256(content.encode()).hexdigest()
                artifact.delivered_version = artifact.version
                artifact.state, artifact.error = 'delivered', None
                changed = True
        return self.event() if changed else None


class ArtifactWriter(BaseTool):
    name = 'file'
    def __init__(self, outcomes):
        super().__init__()
        self.outcomes = outcomes

    @tool('finalize_artifact', '在预算收尾阶段补写或修订已登记文本成果。以成果 id 解析路径；目标已存在时保存系统预留的新版路径，保留原文件及已交付版本。返回实际 filepath，随后用 deliver_files 交付该路径。不新增功能或任意路径，不替代正常开发与二进制生成。',
          {'artifact_id': {'type': 'string'}, 'content': {'type':'string'}}, ['artifact_id','content'])
    async def finalize_artifact(self, artifact_id, content):
        o = self.outcomes
        a = o.artifact(artifact_id)
        if not o.plan_tool.finalizing or o.frozen_ids is None or artifact_id not in o.frozen_ids or not a or a.delivery != 'file' or not a.path:
            return ToolResult(success=False, message="仅能在收尾阶段补写进入收尾前已登记的文本文件")
        if not content or len(content) > 1000000:
            return ToolResult(success=False, message="收尾内容不能为空，且最多 1000000 字符；不可截断交付")
        if a.final_writes or a.final_attempts >= 2:
            return ToolResult(success=False, message="此成果已成功收尾写入，或失败重试额度已用尽")
        # 原路径存在时只写冻结时预留的新版；任何既有字节都不覆盖。
        target = a.path
        try:
            checked = await o.sandbox.check_file_exists(target)
        except Exception:
            return ToolResult(success=False, message="无法确认目标文件是否存在，保留现有文件；恢复检查后再交付")
        exists = checked.data.get('exists') if isinstance(checked.data, dict) else None
        if not checked.success or type(exists) is not bool:
            return ToolResult(success=False, message="无法确认目标文件是否存在，收尾未写入")
        if exists:
            target = a.final_path
            if not target:
                return ToolResult(success=False, message="未预留新版路径，保留现有文件")
            try:
                checked = await o.sandbox.check_file_exists(target)
            except Exception:
                return ToolResult(success=False, message="无法确认新版路径，收尾未写入")
            if not checked.success or not isinstance(checked.data, dict) or checked.data.get('exists') is not False:
                return ToolResult(success=False, message="新版路径已存在或无法确认，不覆盖任何文件")
        a.final_attempts += 1
        result = await o.sandbox.write_file(filepath=target, content=content)
        if result.success:
            a.final_writes += 1
            a.path = target
        return ToolResult(success=result.success, message=result.message,
                          data={'artifact_id': artifact_id, 'filepath': target, 'result': result.data})
