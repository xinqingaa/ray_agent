"""计划工具：原子更新稳定阶段与步骤，不调度、不推断业务完成。"""
from typing import Any, Dict, List, Optional
from pydantic import ValidationError
from app.domain.models.plan import Artifact, ExecutionStatus, Plan, Step
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool

UPDATE_PLAN_TOOL = "update_plan"
STATUS = {"pending": ExecutionStatus.PENDING, "in_progress": ExecutionStatus.RUNNING,
          "completed": ExecutionStatus.COMPLETED, "blocked": ExecutionStatus.BLOCKED,
          "cancelled": ExecutionStatus.CANCELLED}


class PlanTool(BaseTool):
    name = "plan"

    def __init__(self):
        super().__init__()
        self.latest_plan: Optional[Plan] = None
        self.user_seqs: set[int] = set()
        self.current_user_seq: Optional[int] = None
        self.evidence_calls: set[str] = set()
        self.finalizing = False
        self.plan_mode = False
        self.adopted = False

    def _source(self, seq):
        return seq is not None and seq in self.user_seqs

    @tool(name=UPDATE_PLAN_TOOL, description=(
        "记录目标、稳定阶段与步骤，替换完整清单，不执行步骤。"
        "stage 为整体阶段，step 携 parent_id 从属阶段，两层分开计数。新增 id 可省略，后续复用；步骤以 parent_id 引用阶段。"
        "最多一个 stage 和 step in_progress；展开不删除阶段或改为步骤。"
        "current 为本轮，future 仅为用户安排的后续；资源不足用 blocked 和 reason。"
        "结构调整、重开、取消或改范围须 explanation；source_seq 引用用户消息，自身建议不算授权。"
        "主要工作前登记问题、判断与路径，可与首批业务动作同轮。title 简短，description 一句说明，step 用动作与具体对象或结果组成短标题，不枚举正文或附解释；goal/scope 保留目标与本次范围；大纲、规格与核验条件不放标题。推导、选择与内容设计和制作、核验、交付按目标组织，不套固定阶段；产物建议、讲解、模拟不算实际完成。小任务可平铺；跨阶段保留 stage，独立关键工作用 step。按阶段成果合并相关动作，不笼统、重复或分列内容、组件、检查细节。首次列全部阶段与首阶段关键步骤，其余进入时展开。开始、完成、切换或受阻时更新子步骤，可与业务动作同批；如实记录，不补造计划，不按页面、工具或固定数量拆分。artifacts 登记必要或承诺成果，file 携沙箱绝对 path，reply 为回复正文。"
        "成果复用 id；不增加纯核对往返。无关新任务 reset=true 并说明目标；简单回答不必调用。"
    ), parameters={
        "action": {"type": "string", "enum": ["update", "review", "not_needed"]},
        "step_id": {"type": "string"},
        "title": {"type": "string", "description": "简短任务标题"},
        "description": {"type": "string", "description": "一句任务说明，详细要求保留在 goal/scope"},
        "goal": {"type": "string"}, "scope": {"type": "string"},
        "source_seq": {"type": "integer", "description": "仅已知时填写真实用户消息 seq；省略自动采用当前消息，不能猜测序号"},
        "explanation": {"type": "string"}, "reset": {"type": "boolean"},
        "plan": {"type": "array", "description": "完整路径承接问题、判断与交付。保留 stage，独立关键工作用携 parent_id 的 step；选定当前项，不复述父阶段或铺开细节。", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "step": {"type": "string", "description": "动作与具体对象或结果组成短标题，不附内容列表、规格或解释"},
            "kind": {"type": "string", "enum": ["stage", "step"]},
            "parent_id": {"type": "string"},
            "status": {"type": "string", "enum": list(STATUS)},
            "schedule": {"type": "string", "enum": ["current", "future"]},
            "reason": {"type": "string"},
        }, "required": ["step", "status"]}},
        "artifacts": {"type": "array", "description": "提供时为完整成果清单，省略则保留原清单", "items": {
            "type": "object", "properties": {
                "id": {"type": "string"}, "name": {"type": "string"}, "path": {"type": "string"},
                "delivery": {"type": "string", "enum": ["file", "reply"]},
                "required": {"type": "boolean"}, "source": {"type": "string", "enum": ["user", "agent"]},
                "schedule": {"type": "string", "enum": ["current", "future"]},
            }, "required": ["name", "delivery"]}},
    }, required=[])
    async def update_plan(self, plan: Optional[List[Dict[str, Any]]] = None, explanation: Optional[str] = None,
                          reset: bool = False, action: str = "update", step_id: Optional[str] = None,
                          goal: Optional[str] = None, scope: Optional[str] = None,
                          title: Optional[str] = None, description: Optional[str] = None,
                          source_seq: Optional[int] = None, artifacts: Optional[List[Dict[str, Any]]] = None):
        old = self.latest_plan
        seq = source_seq if source_seq is not None else self.current_user_seq
        if source_seq is not None and not self._source(seq):
            return ToolResult(success=False, message=f"source_seq 必须引用已保存的真实用户消息 {sorted(self.user_seqs)}；不知道时省略，自动采用当前消息")
        if action == "not_needed":
            unrelated = bool(old and goal and goal.strip() != old.goal and explanation and self._source(seq) and seq != old.source_seq)
            if self.adopted or (old and not old.done and not unrelated):
                return ToolResult(success=False, message="原任务仍有未完成范围；延续时保留清单，无关新任务用 reset 并提供新目标")
            return ToolResult(data={"action": action}, message="本次无需计划")
        if action == "review":
            if old and any(s.id == step_id and s.status == ExecutionStatus.RUNNING for s in old.steps):
                return ToolResult(data={"action": action}, message="已确认当前步骤；正常执行无需定时 review")
            return ToolResult(success=False, message="当前步骤 id 无效；复用清单中进行中项的 id")
        if action != "update" or not isinstance(plan, list) or not plan:
            return ToolResult(success=False, message="update 需要非空完整 plan")
        if reset and old and (not goal or not goal.strip() or not explanation or goal.strip() == old.goal or not self._source(seq) or seq == old.source_seq):
            return ToolResult(success=False, message="新任务 reset 需要不同的新 goal 与 explanation，不能重置同一目标以隐藏缺口")
        if self.finalizing and (reset or (artifacts and any(not a.get('id') for a in artifacts))):
            return ToolResult(success=False, message="收尾阶段只能更新已有任务和已登记成果，不能新增范围")
        existing = {s.id: s for s in old.steps} if old and not reset else {}
        steps, used = [], set()
        try:
            for i, item in enumerate(plan):
                if not isinstance(item, dict) or not isinstance(item.get("step"), str) or not item["step"].strip():
                    raise ValueError(f"plan[{i}].step 需要非空文本")
                if item.get("status") not in STATUS:
                    raise ValueError(f"plan[{i}].status 只允许 {list(STATUS)}；后续安排使用 schedule=future")
                sid = item.get("id")
                if sid is not None and (not isinstance(sid, str) or not sid.strip() or sid in used):
                    raise ValueError(f"id {sid!r} 无效或重复；当前有效 id：" + "；".join(existing))
                prior = existing.get(sid)
                if sid: used.add(sid)
                data = prior.model_dump() if prior else {}
                if sid is not None: data["id"] = sid
                data.update(description=item["step"].strip(), status=STATUS[item["status"]])
                for key in ("kind", "parent_id", "schedule", "reason"):
                    if key in item: data[key] = item[key]
                node = Step.model_validate(data)
                node.source_seq = prior.source_seq if prior else seq
                if node.schedule == 'future' and node.status not in (ExecutionStatus.PENDING, ExecutionStatus.CANCELLED):
                    raise ValueError("后续阶段只能未开始；预算或环境不足用 blocked，不能改为 future")
                if node.status in (ExecutionStatus.BLOCKED, ExecutionStatus.CANCELLED) and not node.reason.strip():
                    raise ValueError("受阻或取消需 reason")
                if prior and (node.kind != prior.kind or node.parent_id != prior.parent_id):
                    raise ValueError("已有项不能改变层级归属；拆分请保留阶段 id 并调整子步骤")
                if prior and (prior.done and not node.done or prior.schedule != node.schedule or node.status == ExecutionStatus.CANCELLED and prior.status != node.status):
                    if not explanation or not explanation.strip(): raise ValueError("重新打开、取消或改变范围需要 explanation")
                    if node.schedule == 'future' or node.status == ExecutionStatus.CANCELLED:
                        if not self._source(seq) or seq == prior.source_seq:
                            raise ValueError("推迟本轮要求或取消需要新的真实用户范围来源；资源不足保留为 blocked")
                        node.source_seq = seq
                steps.append(node)
            stages = {s.id: s for s in steps if s.kind == 'stage'}
            if not stages: raise ValueError("清单至少包含一个整体 stage")
            for s in steps:
                if s.kind == 'stage' and s.parent_id: raise ValueError("stage 不能携 parent_id")
                if s.kind == 'step' and s.parent_id not in stages: raise ValueError("step 的 parent_id 必须属于当前 stage")
                if s.kind == 'step' and s.status == ExecutionStatus.RUNNING and stages[s.parent_id].status != ExecutionStatus.RUNNING:
                    raise ValueError("进行中步骤所属阶段也必须 in_progress")
            for kind in ('stage', 'step'):
                if sum(s.kind == kind and s.status == ExecutionStatus.RUNNING for s in steps) > 1:
                    raise ValueError(f"最多一个 {kind} in_progress")
            for s in stages.values():
                if s.status == ExecutionStatus.COMPLETED and any(c.parent_id == s.id and not c.done for c in steps):
                    raise ValueError("阶段还有未完成子步骤，不能标 completed")
            dropped = [s for s in existing.values() if s.id not in used]
            if dropped and (not explanation or not explanation.strip()): raise ValueError("删除或拆并清单项需要 explanation")
            if any(s.kind == 'stage' for s in dropped):
                raise ValueError("整体阶段不能直接删除；保留稳定身份，用户取消时保留取消项及来源")
            if old and not reset and goal is not None and goal != old.goal and not explanation:
                raise ValueError("修改整体目标需要 explanation")
            outs = self._artifacts(artifacts, old if not reset else None, seq, explanation)
        except (ValueError, ValidationError) as e:
            return ToolResult(success=False, message=str(e))
        updated = Plan(title=(title if title is not None else old.title if old and not reset else ""),
                       description=(description if description is not None else old.description if old and not reset else ""),
                       steps=steps, artifacts=outs, goal=(goal if goal is not None else old.goal if old and not reset else ''),
                       scope=(scope if scope is not None else old.scope if old and not reset else ''), source_seq=seq,
                       message=explanation or '', verifications=old.verifications if old and not reset else [])
        if old and not reset: updated.id = old.id
        updated.status = ExecutionStatus.COMPLETED if updated.done else ExecutionStatus.RUNNING
        self.latest_plan = updated
        children = [s for s in updated.steps if s.kind == 'step']
        return ToolResult(message=f"计划已更新：整体阶段 {len(updated.stages)} 项，已完成 {sum(s.status == ExecutionStatus.COMPLETED for s in updated.stages)} 项；子步骤 {len(children)} 项，已完成 {sum(s.status == ExecutionStatus.COMPLETED for s in children)} 项",
                          data={"plan_id": updated.id, "source_seq": seq, "title": updated.title,
                                "description": updated.description, "plan": [self._node(s) for s in steps],
                                "artifacts": [a.model_dump() for a in outs]})

    def _artifacts(self, items, old, seq, explanation):
        previous = {a.id: a for a in old.artifacts} if old else {}
        if items is None: return [a.model_copy(deep=True) for a in previous.values()]
        out, seen, paths = [], set(), set()
        for item in items:
            aid = item.get('id')
            if aid is not None and (not isinstance(aid, str) or not aid.strip() or aid in seen): raise ValueError("成果 id 无效或重复")
            if aid: seen.add(aid)
            prior = previous.get(aid)
            data = prior.model_dump() if prior else {}
            if any(k not in {'id','name','path','delivery','required','source','schedule'} for k in item):
                raise ValueError("成果只声明身份和要求，版本及交付状态由实际工具结果填写")
            data.update(item)
            a = Artifact.model_validate(data)
            if not a.name.strip(): raise ValueError("成果 name 不能为空")
            if a.delivery == 'file' and ((not a.path and a.schedule == 'current') or
                    (a.path and (not a.path.startswith('/') or a.path.endswith('/') or '..' in a.path.split('/')))):
                raise ValueError("文件成果需明确的沙箱绝对 path，不能包含 ..")
            if a.delivery == 'file':
                if a.path and a.path in paths: raise ValueError("不同成果不能共用同一文件路径")
                if a.path: paths.add(a.path)
            if prior and (prior.required and not a.required or prior.schedule == 'current' and a.schedule == 'future' or prior.delivery != a.delivery):
                if not explanation or not self._source(seq) or seq == prior.source_seq:
                    raise ValueError("改变既有成果要求需要新的用户范围来源与 explanation")
            if self.finalizing and prior and (prior.path != a.path or prior.delivery != a.delivery or prior.required != a.required or prior.schedule != a.schedule):
                raise ValueError('收尾不能改变已登记成果要求')
            if prior and prior.path != a.path:
                if self.finalizing: raise ValueError("收尾不能更换已登记路径")
                a.version, a.state, a.error = None, 'pending', None
            a.source_seq = prior.source_seq if prior else seq
            out.append(a)
        if any(a.required and a.id not in seen for a in previous.values()):
            raise ValueError("必要成果不能省略；保留记录并按用户范围更新安排")
        return out

    @staticmethod
    def _node(s):
        return {"id": s.id, "step": s.description, "status": 'in_progress' if s.status == ExecutionStatus.RUNNING else s.status.value,
                "kind": s.kind, "parent_id": s.parent_id, "schedule": s.schedule, "reason": s.reason}
