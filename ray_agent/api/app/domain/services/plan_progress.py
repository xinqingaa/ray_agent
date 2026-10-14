"""事件驱动范围核对；阶段推进由模型负责，没有定时批次核对。"""
import json

from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent

PLAN_PROGRESS_PREFIX = "[计划核对]"
COMPLETION_FEEDBACK_PREFIX = "结束前一致性核对："
TASK_STATE_PREFIX = "[任务状态]"
VERIFICATION_NOTICE_PREFIX = "[系统提示]核验记录提醒："
STEP_NOTICE_PREFIX = "[系统提示]步骤进度提醒："
INTERNAL_CHECK_NOTE = ("这是内部核对，不在最终答复复述。上一条草稿尚未交给用户；最终答复必须独立阅读，"
                       "保留用户需要的正文。文件交付说明累计成果、关键结果、使用方式、关键核验及真实缺口，使用已交付附件入口；"
                       "并列信息用短段落或列表，较长正文用标题，遵从用户指定的格式和篇幅。")
OPEN_ITEMS_ISSUE = "本次范围仍有未完成项；完成后更新状态，资源不足标 blocked 并说明，不能改为后续以消除缺口"
NON_BUSINESS = {"update_plan", "message_ask_user", "discover_mcp_tools", "get_remote_agent_cards",
                "shell_wait_process", "shell_read_output", "browser_view", "browser_tabs"}


def staged_feedback(plan):
    return "仍有用户安排的后续阶段，说明整体目标位置、本次成果和后续范围，不称整个目标完成。"


class PlanProgress:
    def __init__(self):
        self.required = None
        self.corrected = self.noticed = self.not_needed = False
        self.plan_updated = self.feedback_sent = False
        self.planned = False
        self.unrecorded_calls = 0
        self.verification_noticed = False
        self.step_noticed: set[tuple[str, str]] = set()

    def observe(self, event):
        if isinstance(event, PlanEvent):
            if event.progress_state == 'preparing':
                self.required = 'adopted'
            else:
                self.planned = True
                self.plan_updated |= not event.review_only
                self.not_needed = event.progress_state == 'not_needed'
                if self.required != 'adopted' or any(s.status.value == 'running' for s in event.plan.stages):
                    self.required = None
        elif isinstance(event, ContextEvent) and event.op.value == 'append':
            self.feedback_sent |= any(str(m.get('content') or '').startswith(COMPLETION_FEEDBACK_PREFIX) for m in event.messages or [])
            self.verification_noticed |= any(str(m.get('content') or '').startswith(VERIFICATION_NOTICE_PREFIX) for m in event.messages or [])
            for message in event.messages or []:
                content = str(message.get('content') or '')
                if content.startswith(STEP_NOTICE_PREFIX):
                    try:
                        identity = json.loads(content[len(STEP_NOTICE_PREFIX):].split('\n', 1)[0])
                        self.step_noticed.add((identity['plan_id'], identity['stage_id']))
                    except (ValueError, KeyError, TypeError):
                        pass
            if event.plan_check == 'scope':
                self.required, self.corrected, self.noticed = 'scope', False, False
            elif event.plan_check == 'notice': self.noticed = True
            elif event.plan_check == 'corrected': self.corrected = True
        elif isinstance(event, ToolEvent) and event.status.value == 'called':
            if event.function_name in {'shell_execute', 'browser_console_exec', 'read_file'} and not (event.function_args or {}).get('verification'):
                self.unrecorded_calls += 1

    def step_notice(self, plan):
        if self.not_needed or not self.planned or not plan:
            return None
        for stage in plan.stages:
            identity = (plan.id, stage.id)
            if stage.status.value != 'running' or identity in self.step_noticed:
                continue
            children = [step for step in plan.steps if step.kind == 'step' and step.parent_id == stage.id and step.open]
            all_children = [step for step in plan.steps if step.kind == 'step' and step.parent_id == stage.id]
            expand = not all_children and len(plan.stages) > 1
            if not expand and (not children or any(step.status.value in ('running', 'blocked') for step in children)):
                continue
            instruction = ('当前阶段尚无子步骤。有多个独立关键工作时以 kind=step、parent_id 引用阶段 id 展开，选定当前项；'
                           '保留阶段与 id，按成果合并相关动作。条目只写动作与对象或结果的短标题，不重复父阶段或分列细节；独立短操作可平铺。') if expand else (
                           '当前阶段已有未完成子步骤，但没有进行中步骤。继续执行时选定实际当前步骤，完成后及时更新并选定下一项；')
            return (STEP_NOTICE_PREFIX + json.dumps({'plan_id': plan.id, 'stage_id': stage.id}, ensure_ascii=False) + '\n'
                    + instruction +
                    '可与业务动作同批调用 update_plan。已实际完成的短操作可以同批完成，不为提醒增加额外核对，不伪造进度。')
        return None

    def verification_notice(self, plan):
        if self.verification_noticed or self.unrecorded_calls < 6 or not plan or not plan.artifacts:
            return None
        return VERIFICATION_NOTICE_PREFIX + '已有成果且最近多次调用未登记关键核验。若这些动作是核验，随必要业务调用附 verification 记录成果、条件和通过断言，复用同版本同条件的证据；真实缺陷定向修复，主要成果已满足时交付。普通执行无需伪造通过，不为登记另开核对调用。'

    def reason(self, plan):
        if self.not_needed: return None
        if self.required: return self.required
        if plan and not self.planned and plan.done: return 'closed'
        if plan and not self.planned and any(s.deferred for s in plan.stages) and not any(s.open for s in plan.stages): return 'staged'
        if plan and not self.planned: return 'continuation'
        return None

    def notice(self, plan):
        reason = self.reason(plan)
        if not reason or self.noticed or (reason == 'scope' and not plan): return None
        instruction = {
            'adopted': '用户已确认这份清单，首批业务动作前选定当前阶段，复用阶段 id。',
            'scope': '用户补充了要求，更新相关范围和步骤，保留有效成果；实现细节无需反复确认。',
            'staged': '延续时复用计划，展开本次安排的阶段；无关新任务注明新目标再 reset。',
            'closed': '原计划已经结束；延续修改时说明重新打开的原因，无关新任务才 reset。',
            'continuation': '先判断当前用户指令是否延续既有任务。延续时复用清单并更新当前范围；无关任务用新目标 reset，或 action=not_needed 携新目标和原因。直接回答无需计划。',
        }[reason]
        return PLAN_PROGRESS_PREFIX + instruction + ' 可以与业务动作同批更新；直接回答无需额外核对。'

    def blocks(self, calls, plan):
        reason = self.reason(plan)
        if reason not in ('adopted', 'scope', 'staged', 'closed', 'continuation'): return False
        return any(c['function']['name'] not in NON_BUSINESS for c in calls)

    def due(self, plan): return self.reason(plan) is not None
    def missing(self, plan): return not self.planned and not plan
