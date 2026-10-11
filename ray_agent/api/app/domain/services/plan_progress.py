"""可回放的有界计划核对；只计有效业务批次，不推断业务完成。"""
from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent, ToolEventStatus, TurnEvent, TurnPhase

PLAN_PROGRESS_PREFIX = "[计划核对]"
BATCH_THRESHOLD = 3
POLL_TOOLS = {"shell_wait_process", "shell_read_output", "browser_view", "browser_tabs"}
NON_BUSINESS = POLL_TOOLS | {"update_plan", "message_ask_user", "discover_mcp_tools", "get_remote_agent_cards"}


class PlanProgress:
    def __init__(self):
        self.batches = 0
        self.activity = self.updated = self.planned = False
        self.required = None
        self.corrected = self.degraded = self.noticed = self.not_needed = False

    def observe(self, event):
        if isinstance(event, PlanEvent):
            if event.progress_state == "unconfirmed":
                self.degraded, self.required = True, None
            elif event.progress_state == "preparing":
                self.required = "adopted"
                self.planned = True
            else:
                self.batches = 0
                self.updated = True
                self.planned = True
                self.not_needed = event.progress_state == "not_needed"
                self.degraded = self.noticed = False
                self.required = ("adopted" if self.required == "adopted" and
                    not any(s.status.value == "running" for s in event.plan.steps) else None)
        elif isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED:
            if (event.function_name not in NON_BUSINESS and not event.denied_by
                    and event.function_result and event.function_result.success):
                self.activity = True
        elif isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED:
            if self.activity and not self.updated:
                self.batches += 1
            self.activity = self.updated = False
        elif isinstance(event, ContextEvent) and event.op.value == "append":
            action = event.plan_check
            if action == "scope":
                self.corrected = self.degraded = self.noticed = self.not_needed = False
                self.required = "scope"
            elif action == "notice":
                self.noticed = True
            elif action == "corrected":
                self.corrected = True

    def reason(self, plan):
        if self.degraded or self.not_needed:
            return None
        if self.required:
            return self.required
        if plan and plan.steps and all(s.done for s in plan.steps) and not self.planned:
            return "closed"
        if self.batches >= BATCH_THRESHOLD and (not plan or any(not s.done for s in plan.steps) or not self.planned):
            return "due"
        return None

    def notice(self, plan):
        reason = self.reason(plan)
        if not reason or self.noticed:
            return None
        instruction = {
            "adopted": "用户已确认这份计划；首批业务动作前用 update_plan 选定进行中的步骤，保留步骤 id。",
            "closed": "上一份计划已结束；本次首个写操作前建立新计划(reset=true)，或声明 action=not_needed。",
            "scope": "用户补充了要求；继续动作前核对范围，延续/调整计划，或声明本次无需计划。不要自动清空已完成项。",
            "due": "已连续完成 3 批业务工具；继续前更新计划、用 action=review 与当前 step_id 确认仍在此步骤，或声明 action=not_needed。",
        }[reason]
        current = ([{"id": s.id, "step": s.description, "status": s.status.value} for s in plan.steps] if plan else [])
        return f"{PLAN_PROGRESS_PREFIX} {instruction} 可先核对再在同一回复中执行动作；若本次工作已经完成，直接最终答复，无需为核对追加工具。不要虚报完成。当前清单：{current}"

    def blocks(self, calls, plan):
        reason = self.reason(plan)
        if not reason:
            return False
        from app.domain.services.plan_mode import PLAN_MODE_ALLOWED
        names = [c["function"]["name"] for c in calls if c["function"]["name"] not in NON_BUSINESS]
        return any(name not in PLAN_MODE_ALLOWED for name in names) if reason == "closed" else bool(names)

    def missing(self, plan):
        return not self.planned and not (plan and any(not s.done for s in plan.steps))

    def due(self, plan):
        return self.reason(plan) is not None
