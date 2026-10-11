#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""计划清单工具：模型整表提交计划，工具只校验并保存，不参与调度。"""
from typing import Any, Dict, List, Optional

from app.domain.models.plan import ExecutionStatus, Plan, Step
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool

UPDATE_PLAN_TOOL = "update_plan"

# 模型可见的状态 → 现有 Plan 模型的执行状态
_STATUS_MAP = {
    "pending": ExecutionStatus.PENDING,
    "in_progress": ExecutionStatus.RUNNING,
    "completed": ExecutionStatus.COMPLETED,
    "later": ExecutionStatus.LATER,
}


class PlanTool(BaseTool):
    """维护单次会话内的计划清单。latest_plan 保存最近一次成功提交的结果，供循环发出 PlanEvent。"""
    name: str = "plan"

    def __init__(self, plan: Optional[Plan] = None) -> None:
        super().__init__()
        self.latest_plan: Optional[Plan] = plan

    @tool(
        name=UPDATE_PLAN_TOOL,
        description=(
            "维护当前任务计划。action=update 提交完整清单；review 携 step_id 核对仍在当前步骤；not_needed 声明本次是简单任务无需计划。"
            "适用于需要多个阶段或多次工具调用的任务；简单任务不必使用。"
            "推进时及时更新状态，同一时间最多一项 in_progress。本工具只记录清单，不会执行任何步骤。"
            "新步骤省略 id，结果会返回分配的 id；后续更新、改标题或重排必须复用该 id。"
            "清单只描述当前这次请求；与已有清单无关的新任务用 reset=true，延续原任务（包括进入下一阶段）不用。"
            "任务分多个阶段时，当前阶段展开为子步骤；pending 只用于本轮打算执行的步骤，本轮不执行的阶段用 later 保留；进入下一阶段时把它展开为子步骤，并按本轮安排改为 pending 或 in_progress。"
            "只给方案、本轮不执行时，各阶段都标 later，不要把撰写方案、查资料、交付等自身动作列为步骤；已有后续阶段（later）不要无故省略或用自身动作替换；用户取消要求或阶段拆分、合并时可移除，但须在 explanation 说明原因，沿用原计划身份。"
        ),
        parameters={
            "action": {"type": "string", "enum": ["update", "review", "not_needed"], "description": "默认 update；review 不重写清单，not_needed 不表示旧计划已完成"},
            "step_id": {"type": "string", "description": "review 时提供当前进行中的步骤 id"},
            "plan": {
                "type": "array",
                "description": "完整的计划清单，按执行顺序排列",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "已有步骤返回的稳定 ID；新增步骤省略，不要自行编造"},
                        "step": {"type": "string", "description": "步骤的简短描述"},
                        "status": {
                            "type": "string",
                            "enum": list(_STATUS_MAP),
                            "description": "pending 本轮打算执行但未开始 / in_progress 进行中 / completed 已完成 / later 本轮不执行的后续阶段，保留",
                        },
                    },
                    "required": ["step", "status"],
                },
            },
            "explanation": {
                "type": "string",
                "description": "本次调整计划的原因；移除已有 later 条目时必填，说明用户范围变更或阶段重组",
            },
            "reset": {"type": "boolean", "description": "新任务建立全新计划时为 true；延续当前任务为 false"},
        },
        required=[],
    )
    async def update_plan(self, plan: Optional[List[Dict[str, Any]]] = None, explanation: Optional[str] = None,
                          reset: bool = False, action: str = "update", step_id: Optional[str] = None) -> ToolResult:
        if action == "not_needed":
            return ToolResult(success=True, message="本次无需计划；旧清单不作为本次进度", data={"action": action})
        if action == "review":
            if not self.latest_plan or not any(s.id == step_id and s.status == ExecutionStatus.RUNNING for s in self.latest_plan.steps):
                running = [s.id for s in self.latest_plan.steps if s.status == ExecutionStatus.RUNNING] if self.latest_plan else []
                return ToolResult(success=False, message="请提供当前进行中的 step_id；开始或转入步骤时先用 update 更新状态"
                                  + (f"。当前进行中：{', '.join(running)}" if running else "。当前没有进行中的步骤"))
            return ToolResult(success=True, message="已核对：仍在当前步骤", data={"action": action, "step_id": step_id})
        if action != "update" or plan is None:
            return ToolResult(success=False, message="update 需要完整 plan；轻量核对使用 review 或 not_needed")
        steps: List[Step] = []
        in_progress = 0
        existing = {step.id: step for step in self.latest_plan.steps} if self.latest_plan and not reset else {}
        used = set()
        for index, item in enumerate(plan):
            if not isinstance(item, dict):
                return ToolResult(success=False, message=f"plan[{index}] 必须是包含 step 与 status 的对象")
            description = item.get("step")
            status = item.get("status")
            if not isinstance(description, str) or not description.strip():
                return ToolResult(success=False, message=f"plan[{index}].step 必须是非空字符串")
            if not isinstance(status, str) or status not in _STATUS_MAP:
                return ToolResult(
                    success=False,
                    message=f"plan[{index}].status 必须是 {' / '.join(_STATUS_MAP)} 之一，实际为 {status!r}",
                )
            in_progress += status == "in_progress"
            step_id = item.get("id")
            if step_id is not None:
                if not isinstance(step_id, str) or step_id not in existing:
                    return ToolResult(success=False, message=f"plan[{index}].id {step_id!r} 不属于当前计划；"
                                      f"请逐字复制当前 id：{self._valid_ids(existing)}；新增步骤请省略 id")
                if step_id in used:
                    return ToolResult(success=False, message=f"plan[{index}].id 重复，同一步骤只能出现一次")
                used.add(step_id)
                step = existing[step_id].model_copy(deep=True)
                step.description, step.status = description.strip(), _STATUS_MAP[status]
            else:
                step = Step(description=description.strip(), status=_STATUS_MAP[status])
            steps.append(step)
        if in_progress > 1:
            return ToolResult(success=False, message=f"同一时间最多一项 in_progress，本次提交了 {in_progress} 项")
        dropped = [step for step in existing.values() if step.deferred and step.id not in used]
        if dropped and (not isinstance(explanation, str) or not explanation.strip()):
            return ToolResult(success=False, message="移除已有后续阶段（later）需要说明原因：" + "；".join(
                f"{step.id}（{step.description[:20]}）" for step in dropped)
                + "。若用户取消要求或阶段拆分、合并，请在 explanation 说明原因；否则保留这些条目，不要为移除条目重置同一任务")

        all_done = bool(steps) and all(step.status == ExecutionStatus.COMPLETED for step in steps)
        updated = Plan(
            steps=steps,
            message=explanation or "",
            status=ExecutionStatus.COMPLETED if all_done else ExecutionStatus.RUNNING,
        )
        if self.latest_plan is not None and not reset:
            updated.id = self.latest_plan.id
        self.latest_plan = updated

        completed = sum(step.status == ExecutionStatus.COMPLETED for step in steps)
        later = sum(step.status == ExecutionStatus.LATER for step in steps)
        message = f"计划已更新：共 {len(steps)} 项，已完成 {completed} 项" + (f"，后续阶段 {later} 项" if later else "")
        return ToolResult(success=True, message=message, data={
            "plan_id": updated.id,
            "plan": [{"id": step.id, "step": step.description,
                      "status": next(key for key, value in _STATUS_MAP.items() if value == step.status)}
                     for step in steps],
        })

    @staticmethod
    def _valid_ids(existing: Dict[str, Step]) -> str:
        return "；".join(f"{step.id}（{step.description[:12]}）" for step in existing.values())
