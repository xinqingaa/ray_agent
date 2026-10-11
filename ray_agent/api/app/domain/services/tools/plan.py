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
            "写入或更新当前任务的计划清单。每次提交完整清单（会整体替换上一版）。"
            "适用于需要多个阶段或多次工具调用的任务；简单任务不必使用。"
            "推进时及时更新状态，同一时间最多一项 in_progress。本工具只记录清单，不会执行任何步骤。"
            "新步骤省略 id，结果会返回分配的 id；后续更新、改标题或重排必须复用该 id。"
            "清单只描述当前这次请求；与已有清单无关的新任务或新阶段用 reset=true，延续原任务则不用。"
        ),
        parameters={
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
                            "description": "pending 未开始 / in_progress 进行中 / completed 已完成",
                        },
                    },
                    "required": ["step", "status"],
                },
            },
            "explanation": {
                "type": "string",
                "description": "(可选)本次调整计划的原因",
            },
            "reset": {"type": "boolean", "description": "新任务建立全新计划时为 true；延续当前任务为 false"},
        },
        required=["plan"],
    )
    async def update_plan(self, plan: List[Dict[str, Any]], explanation: Optional[str] = None,
                          reset: bool = False) -> ToolResult:
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
                    return ToolResult(success=False, message=f"plan[{index}].id 不属于当前计划；新增步骤请省略 id")
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
        return ToolResult(success=True, message=f"计划已更新：共 {len(steps)} 项，已完成 {completed} 项", data={
            "plan_id": updated.id,
            "plan": [{"id": step.id, "step": step.description,
                      "status": next(key for key, value in _STATUS_MAP.items() if value == step.status)}
                     for step in steps],
        })
