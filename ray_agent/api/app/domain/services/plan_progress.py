"""有界计划核对：按已完成工具批次计数，不推断阶段是否完成。"""
from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent, ToolEventStatus, TurnEvent, TurnPhase

PLAN_PROGRESS_PREFIX = "[计划核对]"
PLAN_PROGRESS_NOTICE = (
    f"{PLAN_PROGRESS_PREFIX} 已连续完成 5 个工具批次但未更新计划。请核对当前阶段："
    "若已进入下一阶段，先调用 update_plan 更新状态并复用已有步骤 id；"
    "若仍在当前阶段，按实际情况继续。不要为了更新进度虚报完成。"
)
POLL_TOOLS = {"shell_wait_process", "shell_read_output", "browser_view", "browser_tabs"}


class PlanProgress:
    def __init__(self):
        self.batches = 0
        self.notices = 0
        self.activity = False
        self.updated = False

    def observe(self, event):
        if isinstance(event, PlanEvent):
            self.batches = 0
            self.updated = True
        elif isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED:
            result = event.function_result
            if (event.function_name not in POLL_TOOLS | {"update_plan"} and
                    not event.denied_by and result and result.success):
                self.activity = True
        elif isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED:
            if self.activity and not self.updated:
                self.batches += 1
            self.activity = self.updated = False
        elif isinstance(event, ContextEvent):
            # 压缩 replace 不重复统计已注入提示；原始 append 事件仍在账本里。
            if event.op.value == "append":
                for message in event.messages:
                    if str(message.get("content") or "").startswith(PLAN_PROGRESS_PREFIX):
                        self.notices += 1
                        self.batches = 0

    def due(self, plan):
        return bool(plan and any(not step.done for step in plan.steps) and
                    self.batches >= 5 and self.notices < 2)
