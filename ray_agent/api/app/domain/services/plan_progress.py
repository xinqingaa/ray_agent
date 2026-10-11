"""可回放的有界计划核对；只计有效业务批次，不推断业务完成。"""
from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent, ToolEventStatus, TurnEvent, TurnPhase

PLAN_PROGRESS_PREFIX = "[计划核对]"
COMPLETION_FEEDBACK_PREFIX = "结束前一致性核对："
INTERNAL_CHECK_NOTE = ("这是内部核对：最终答复直接面向用户说明结果，不要提及或复述核对本身。"
                       "上一条无工具调用的草稿尚未作为最终答复交给用户；本次答复必须能独立阅读，保留用户需要的正文，"
                       "不能只写总结或让用户参见上一条草稿。")
OPEN_ITEMS_ISSUE = "当前计划还有未完成条目；完成后更新计划，本轮不再处理的条目可改标 later 并按阶段说明，或明确说明未完成原因"
BATCH_THRESHOLD = 3
POLL_TOOLS = {"shell_wait_process", "shell_read_output", "browser_view", "browser_tabs"}
NON_BUSINESS = POLL_TOOLS | {"update_plan", "message_ask_user", "discover_mcp_tools", "get_remote_agent_cards"}


def staged_feedback(plan) -> str:
    """计划仍有后续阶段时的结束反馈；只写与任务类型无关的原则，当前清单取自计划。"""
    current = [{"id": s.id, "step": s.description, "status": s.status.value} for s in plan.steps]
    return ("本次计划仍有后续阶段（later）。最终答复写成简洁总结：本轮做了什么、实现了什么（用户现在能用什么）、还欠缺什么，"
            "以及本轮完成的是哪个阶段、剩余阶段与建议的下一步；不复述执行过程，不需要表格，不要把本阶段完成说成整个任务完成。"
            f"当前清单：{current}")


class PlanProgress:
    """本次运行的计划核对状态；同时记录结束反馈所需的事实（计划更新、已发出的结束反馈），随事件回放恢复。"""

    def __init__(self):
        self.batches = 0
        self.activity = self.updated = self.planned = False
        self.required = None
        self.corrected = self.degraded = self.noticed = self.not_needed = False
        self.plan_updated = self.feedback_sent = False

    def observe(self, event):
        if isinstance(event, PlanEvent):
            if event.progress_state == "unconfirmed":
                self.degraded, self.required = True, None
            elif event.progress_state == "preparing":
                self.required = "adopted"
                self.planned = True
            else:
                if not event.review_only and event.progress_state == "confirmed":
                    self.plan_updated = True
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
            if any(str(m.get("content") or "").startswith(COMPLETION_FEEDBACK_PREFIX) for m in event.messages or []):
                self.feedback_sent = True
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
        if plan and plan.steps and not self.planned and not any(s.open for s in plan.steps):
            # 本阶段已做完：有后续阶段时延续同一计划，否则视为上一份计划已结束
            return "staged" if any(s.deferred for s in plan.steps) else "closed"
        if self.batches >= BATCH_THRESHOLD and (not plan or any(s.open for s in plan.steps) or not self.planned):
            return "due"
        return None

    def notice(self, plan):
        reason = self.reason(plan)
        if not reason or self.noticed:
            return None
        instruction = {
            "adopted": "用户已确认这份计划；首批业务动作前用 update_plan 选定进行中的步骤，保留步骤 id。",
            "closed": "上一份计划已结束；本次首个写操作前建立新计划(reset=true)，或声明 action=not_needed。",
            "staged": "上一份计划本阶段已完成，仍有后续阶段（later）；本次若延续该任务，先用 update_plan（不要 reset）保留全部条目并把下一阶段展开为子步骤，再继续；若是无关的新任务，用 reset=true 建立新计划，或声明 action=not_needed。",
            "scope": "用户补充了要求；继续动作前核对范围，延续/调整计划，或声明本次无需计划。不要自动清空已完成项。",
            "due": "已连续完成 3 批业务工具；继续前更新计划、用 action=review 与当前 step_id 确认仍在此步骤，或声明 action=not_needed。",
        }[reason]
        current = ([{"id": s.id, "step": s.description, "status": s.status.value} for s in plan.steps] if plan else [])
        return (f"{PLAN_PROGRESS_PREFIX} {instruction} 可先核对再在同一回复中执行动作；若本次工作已经完成，直接最终答复，无需为核对追加工具。"
                f"不要虚报完成。当前清单：{current}")

    def blocks(self, calls, plan):
        reason = self.reason(plan)
        if not reason:
            return False
        from app.domain.services.plan_mode import PLAN_MODE_ALLOWED
        names = [c["function"]["name"] for c in calls if c["function"]["name"] not in NON_BUSINESS]
        return any(name not in PLAN_MODE_ALLOWED for name in names) if reason in ("closed", "staged") else bool(names)

    def missing(self, plan):
        return not self.planned and not (plan and any(s.open for s in plan.steps))

    def due(self, plan):
        return self.reason(plan) is not None
