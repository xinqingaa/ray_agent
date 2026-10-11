"""有界计划核对：按已完成工具批次计数，不推断阶段是否完成。"""
from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent, ToolEventStatus, TurnEvent, TurnPhase

PLAN_PROGRESS_PREFIX = "[计划核对]"
PLAN_PROGRESS_NOTICE = (
    f"{PLAN_PROGRESS_PREFIX} 已连续完成 5 个工具批次但未更新计划。请核对当前阶段："
    "若已进入下一阶段，先调用 update_plan 更新状态并复用已有步骤 id；"
    "若仍在当前阶段，按实际情况继续。不要为了更新进度虚报完成。"
)
# 本次运行还没有自己的计划：没有清单，或清单是上一次任务留下的、已全部完成。
PLAN_MISSING_NOTICE = (
    f"{PLAN_PROGRESS_PREFIX} 本次运行已连续完成 5 个工具批次，但还没有建立计划。"
    "若本次任务包含多个阶段，先调用 update_plan 写出本次计划；"
    "已有清单属于上一次任务时用 reset=true，不要沿用。若只是简单任务，可以继续，无需写计划。"
)
POLL_TOOLS = {"shell_wait_process", "shell_read_output", "browser_view", "browser_tabs"}
BATCH_THRESHOLD = 5
MAX_NOTICES = 2
MAX_MISSING_NOTICES = 1


class PlanProgress:
    def __init__(self):
        self.batches = 0
        self.notices = 0
        self.activity = False
        self.updated = False
        self.planned = False  # 本次运行是否已提交过计划

    def observe(self, event):
        if isinstance(event, PlanEvent):
            self.batches = 0
            self.updated = True
            self.planned = True
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

    def missing(self, plan):
        """本次运行没有自己的有效计划：无清单，或清单已全部完成且不是本次提交的。"""
        return not self.planned and not (plan and any(not step.done for step in plan.steps))

    def notice(self, plan):
        """到期时返回要注入的提醒文本，否则为 None；两种提醒共用每运行两次的上限。"""
        if self.batches < BATCH_THRESHOLD or self.notices >= MAX_NOTICES:
            return None
        if self.missing(plan):
            return PLAN_MISSING_NOTICE if self.notices < MAX_MISSING_NOTICES else None
        return PLAN_PROGRESS_NOTICE if plan and any(not step.done for step in plan.steps) else None

    def due(self, plan):
        return self.notice(plan) is not None
