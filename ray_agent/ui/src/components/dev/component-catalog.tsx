'use client'

import {useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {ThemeToggle} from '@/components/theme-toggle'
import {SessionItem} from '@/components/session-item'
import {cn} from '@/lib/utils'
import type {ApprovalStatus, TimelineItem} from '@/lib/session-view'
import {FixtureClock} from '@/components/run/clock'
import {RunStatusBar} from '@/components/run/status-bar'
import {PlanBar} from '@/components/run/plan-bar'
import {ToolCard} from '@/components/run/tool-card'
import {ToolGroup} from '@/components/run/tool-group'
import {FinalReply, NarrationBlock, UserMessage} from '@/components/run/messages'
import {AskCard} from '@/components/run/ask-card'
import {ApprovalCard} from '@/components/run/approval-card'
import {DeliveryCard} from '@/components/run/delivery-card'
import {AttemptNotice, CompactionNotice} from '@/components/run/notices'
import {RunEndBar} from '@/components/run/run-end-bar'
import {ContextRing} from '@/components/run/context-ring'
import {Timeline} from '@/components/run/timeline-item'
import {McpServerRow} from '@/components/settings/mcp-section'
import {A2aServerRow} from '@/components/settings/a2a-section'
import {ToolPolicySection} from '@/components/settings/tool-policy-section'
import {
  approvalCall,
  approvalMcpCall,
  askStates,
  deliveryStates,
  messageStates,
  PLAN_CHANGED_NOW,
  PLAN_TOOL_RUNNING_NOW,
  PLAN_WALKTHROUGH_NOW,
  planStates,
  planToolRunning,
  planWalkthrough,
  runStates,
  sessionItemStates,
  settingsListStates,
  toolGroups,
  toolStates,
  usageStates,
} from '@/fixtures/states'

type Source = '真实' | '合成'

const SECTIONS = [
  ['status-bar', '运行状态条'],
  ['plan-bar', '计划条'],
  ['tool-card', '工具卡'],
  ['tool-group', '工具组'],
  ['replies', '旁白与最终回复'],
  ['user-message', '用户消息'],
  ['ask-card', '提问卡'],
  ['approval-card', '审批卡'],
  ['delivery-card', '交付卡'],
  ['compaction', '压缩提示'],
  ['attempt', '失败尝试提示'],
  ['run-end', '终态条'],
  ['context-ring', '上下文环'],
  ['session-item', '会话列表项'],
  ['settings-list', '设置列表项'],
  ['composed', '组合：真实会话'],
] as const

function State({label, source, children, className}: {label: string; source: Source; children: ReactNode; className?: string}) {
  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="mb-1.5 flex items-center gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className={cn('rounded-sm px-1.5 leading-5', source === '真实' ? 'bg-state-success-soft text-state-success' : 'bg-muted text-muted-foreground')}>
          {source}
        </span>
      </figcaption>
      {children}
    </figure>
  )
}

function Section({id, title, note, columns = 1, children}: {id: string; title: string; note?: string; columns?: 1 | 2 | 3; children: ReactNode}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t pt-6">
      <h2 id={`${id}-title`} className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 max-w-3xl text-meta text-muted-foreground">{note}</p>}
      <div
        className={cn(
          'mt-4 grid gap-x-6 gap-y-5',
          columns === 2 && 'lg:grid-cols-2',
          columns === 3 && 'md:grid-cols-2 xl:grid-cols-3',
        )}
      >
        {children}
      </div>
    </section>
  )
}

function Surface({children, className}: {children: ReactNode; className?: string}) {
  return <div className={cn('rounded-lg border bg-card p-3', className)}>{children}</div>
}

function InteractiveApproval() {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null)
  const decide = (decision: 'approve' | 'reject') => {
    setSubmitting(decision)
    setTimeout(() => {
      setSubmitting(null)
      setStatus(decision === 'approve' ? 'approved' : 'rejected')
    }, 900)
  }
  return (
    <div className="space-y-2">
      <ApprovalCard
        call={approvalCall}
        status={status}
        decidedAt={status === 'pending' ? null : PLAN_TOOL_RUNNING_NOW + 5000}
        submitting={submitting}
        onApprove={() => decide('approve')}
        onReject={() => decide('reject')}
      />
      {status !== 'pending' && (
        <button type="button" className="text-xs text-signal hover:underline" onClick={() => setStatus('pending')}>
          恢复为待审批
        </button>
      )}
    </div>
  )
}

function ComposedSession({items, statusBar, plan, usage}: {items: TimelineItem[]; statusBar: ReactNode; plan: ReactNode; usage: ReactNode}) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
      {statusBar}
      <div className="max-h-[560px] overflow-y-auto px-4 py-4">
        <Timeline items={items} handlers={{selectedCallId: selected, onOpenCall: setSelected}}/>
      </div>
      <div className="space-y-2 border-t bg-card/60 p-3">
        {plan}
        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-meta text-faint">
          <span>输入框（阶段二接入）</span>
          {usage}
        </div>
      </div>
    </div>
  )
}

const noop = () => toast.info('目录页中的操作不会调用接口')

export function ComponentCatalog() {
  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <h1 className="text-lg font-semibold">组件状态目录</h1>
          <span className="text-xs text-muted-foreground">仅开发模式</span>
          <div className="ml-auto"><ThemeToggle className="size-8"/></div>
        </div>
        <nav aria-label="组件" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2 scrollbar-hide">
          {SECTIONS.map(([id, title]) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 pt-4 pb-24">
        <p className="max-w-3xl text-meta text-muted-foreground">
          逐个组件列出界面与交互子计划要求的全部状态，作为修改组件时的回归入口。标“真实”的状态来自 W1 评测与走查会话的真实事件，
          标“合成”的是这些事件里不会出现的状态，按视图模型契约改写。运行中的计时从夹具记录的时刻开始走秒。
        </p>

        <Section id="status-bar" title="运行状态条" note="状态、已用时间、轮次/上限、当前动作、本次运行 tokens 与停止按钮。只有模型思考中与工具执行中时，当前动作文字有扫光动画。">
          <State label="空闲" source="真实"><RunStatusBar run={runStates.idle}/></State>
          <State label="模型思考中" source="真实"><FixtureClock at={runStates.modelNow}><RunStatusBar run={runStates.model} onStop={noop}/></FixtureClock></State>
          <State label="工具执行中" source="真实"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.tool} onStop={noop}/></FixtureClock></State>
          <State label="等待回复" source="真实"><FixtureClock at={runStates.waitingReplyNow}><RunStatusBar run={runStates.waitingReply} onStop={noop}/></FixtureClock></State>
          <State label="等待审批" source="合成"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.waitingApproval} onStop={noop}/></FixtureClock></State>
          <State label="停止中" source="合成"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.stopping} onStop={noop}/></FixtureClock></State>
          <State label="已完成" source="真实"><RunStatusBar run={runStates.completed}/></State>
          <State label="失败（含原因）" source="合成"><RunStatusBar run={runStates.failed}/></State>
          <State label="已停止" source="合成"><RunStatusBar run={runStates.cancelled}/></State>
          <State label="已中断" source="合成"><RunStatusBar run={runStates.interrupted}/></State>
          <State label="工具执行中（W6 生成速度入口）" source="合成">
            <FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.tool} onStop={noop} outputRate={{tokensPerSecond: 42, estimated: true}}/></FixtureClock>
          </State>
        </Section>

        <Section id="plan-bar" title="计划条" columns={2} note="折叠时显示进度、当前项与其用时；展开为完整清单与说明。计划更新时，变化的项带左侧标记与说明。">
          <State label="无计划（不占位）" source="真实">
            <Surface className="text-meta text-faint">
              <PlanBar plan={planStates.none} runStatus="running"/>
              短任务不调用 update_plan，计划条不渲染。
            </Surface>
          </State>
          <State label="进行中（折叠）" source="真实">
            <FixtureClock at={planStates.inProgressNow}><PlanBar plan={planStates.inProgress} runStatus="running"/></FixtureClock>
          </State>
          <State label="进行中（展开）" source="真实">
            <FixtureClock at={planStates.inProgressNow}><PlanBar plan={planStates.inProgress} runStatus="running" defaultExpanded/></FixtureClock>
          </State>
          <State label="全部完成" source="真实">
            <PlanBar plan={planStates.allDone} runStatus="completed" defaultExpanded/>
          </State>
          <State label="运行结束时有未完成项" source="合成">
            <PlanBar plan={planStates.endedUnfinished} runStatus="cancelled" defaultExpanded/>
          </State>
          <State label="计划被修改（状态变化）" source="真实">
            <FixtureClock at={PLAN_CHANGED_NOW}><PlanBar plan={planStates.changed} runStatus="running" defaultExpanded/></FixtureClock>
          </State>
          <State label="计划被修改（新增与删除）" source="合成">
            <FixtureClock at={planStates.inProgressNow + 1500}><PlanBar plan={planStates.rewritten} runStatus="running" defaultExpanded/></FixtureClock>
          </State>
        </Section>

        <Section id="tool-card" title="工具卡" columns={2} note="按工具族显示图标，动词标题与关键参数在一行内，状态、耗时与结果摘要右对齐。点击行展开参数与结果原文，并在工作台打开该调用。">
          <State label="运行中" source="真实"><Surface><FixtureClock at={PLAN_TOOL_RUNNING_NOW}><ToolCard call={toolStates.running} onOpen={noop}/></FixtureClock></Surface></State>
          <State label="成功" source="真实"><Surface><ToolCard call={toolStates.succeeded} onOpen={noop}/><ToolCard call={toolStates.succeededShell} onOpen={noop}/></Surface></State>
          <State label="失败" source="合成"><Surface><ToolCard call={toolStates.failed} onOpen={noop}/></Surface></State>
          <State label="被拒绝" source="合成"><Surface><ToolCard call={toolStates.denied} onOpen={noop}/></Surface></State>
          <State label="未执行" source="合成"><Surface><ToolCard call={toolStates.skipped} onOpen={noop}/></Surface></State>
          <State label="已取消" source="合成"><Surface><ToolCard call={toolStates.cancelled} onOpen={noop}/></Surface></State>
          <State label="结果被截断（展开）" source="合成"><Surface><ToolCard call={toolStates.truncated} onOpen={noop} defaultExpanded/></Surface></State>
          <State label="参数过长（展开）" source="合成"><Surface><ToolCard call={toolStates.longArgs} onOpen={noop} defaultExpanded/></Surface></State>
          <State label="选中（在工作台显示中）" source="真实"><Surface><ToolCard call={toolStates.succeeded} selected onOpen={noop}/></Surface></State>
        </Section>

        <Section id="tool-group" title="工具组" columns={3} note="一轮多个调用时整体显示为一组，标题给出数量与整体状态；一轮只有一个调用时直接显示工具卡。">
          <State label="部分完成" source="合成"><Surface><FixtureClock at={PLAN_TOOL_RUNNING_NOW}><ToolGroup calls={toolGroups.partial}/></FixtureClock></Surface></State>
          <State label="全部成功" source="真实"><Surface><ToolGroup calls={toolGroups.allSucceeded}/></Surface></State>
          <State label="含失败" source="合成"><Surface><ToolGroup calls={toolGroups.withFailure}/></Surface></State>
        </Section>

        <Section id="replies" title="旁白与最终回复" columns={2} note="旁白比最终回复弱一级；最终回复下方附所属运行的汇总。">
          <State label="旁白" source="真实"><Surface><NarrationBlock text={messageStates.narration}/></Surface></State>
          <State label="旁白（W6 增量渲染入口）" source="合成"><Surface><NarrationBlock text={messageStates.narration.slice(0, 18)} streaming/></Surface></State>
          <State label="短文本" source="真实"><Surface><FinalReply text={messageStates.finalShort.text} summary={messageStates.finalShort.summary}/></Surface></State>
          <State label="表格" source="真实"><Surface><FinalReply text={messageStates.finalTable.text} summary={messageStates.finalTable.summary}/></Surface></State>
          <State label="长文本与代码块" source="合成" className="lg:col-span-2"><Surface><FinalReply text={messageStates.finalLong.text} summary={messageStates.finalLong.summary}/></Surface></State>
        </Section>

        <Section id="user-message" title="用户消息" columns={3}>
          <State label="普通" source="真实"><Surface><UserMessage text={messageStates.user.text}/></Surface></State>
          <State label="带附件" source="真实"><Surface><UserMessage text={messageStates.userWithAttachment.text} attachments={messageStates.userWithAttachment.attachments}/></Surface></State>
          <State label="补充要求" source="合成"><Surface><UserMessage text={messageStates.userInjected.text} injected/></Surface></State>
        </Section>

        <Section id="ask-card" title="提问卡" columns={2} note="等待回复时，输入框提示“输入回复，回复将继续当前任务”。">
          <State label="等待回复" source="真实"><AskCard question={askStates.waiting.question} answered={false}/></State>
          <State label="已回复" source="真实"><AskCard question={askStates.answered.question} answered/></State>
        </Section>

        <Section id="approval-card" title="审批卡" columns={2} note="焦点在卡片内时按 Y 批准、N 拒绝，也可用 Tab 选中按钮后回车。接口由 W7.2 接入。">
          <State label="待审批" source="合成"><ApprovalCard call={approvalCall} status="pending" onApprove={noop} onReject={noop}/></State>
          <State label="提交中" source="合成"><ApprovalCard call={approvalCall} status="pending" submitting="approve" onApprove={noop} onReject={noop}/></State>
          <State label="已批准" source="合成"><ApprovalCard call={approvalCall} status="approved" decidedAt={PLAN_TOOL_RUNNING_NOW + 4200}/></State>
          <State label="已拒绝" source="合成"><ApprovalCard call={approvalCall} status="rejected" decidedAt={PLAN_TOOL_RUNNING_NOW + 4200}/></State>
          <State label="已失效（运行中断）" source="合成"><ApprovalCard call={approvalCall} status="expired"/></State>
          <State label="待审批（MCP 工具）" source="合成"><ApprovalCard call={approvalMcpCall} status="pending" onApprove={noop} onReject={noop}/></State>
          <State label="可操作示例" source="合成"><InteractiveApproval/></State>
        </Section>

        <Section id="delivery-card" title="交付卡" columns={3}>
          <State label="单文件" source="真实"><DeliveryCard files={deliveryStates.single.files} note={deliveryStates.single.note} onPreview={noop} onDownload={noop}/></State>
          <State label="多文件" source="合成"><DeliveryCard files={deliveryStates.multiple.files} note={deliveryStates.multiple.note} onPreview={noop} onDownload={noop} onDownloadAll={noop}/></State>
          <State label="预览不可用" source="合成"><DeliveryCard files={deliveryStates.previewUnavailable.files} note={deliveryStates.previewUnavailable.note} onPreview={noop} onDownload={noop}/></State>
        </Section>

        <Section id="compaction" title="压缩提示" note="W2 合入后由 compact 事件产生；摘要全文在开发者视图。">
          <State label="一次压缩" source="合成"><Surface><CompactionNotice beforeTokens={41_236} afterTokens={6_310} summarizedTurns={8}/></Surface></State>
        </Section>

        <Section id="attempt" title="失败尝试提示" columns={2} note="W6 的 attempt 事件；失败的请求不进入模型历史。">
          <State label="已重试" source="合成"><Surface><AttemptNotice attempt={1} reason="连接中断，已收到 312 个字符" retried/></Surface></State>
          <State label="最终失败" source="合成"><Surface><AttemptNotice attempt={3} reason="请求超时（120 秒）" retried={false}/></Surface></State>
        </Section>

        <Section id="run-end" title="终态条" note="非 completed 的运行结束方式；失败时可以相同内容再发一次，不删除已有事件。">
          <State label="失败" source="合成"><RunEndBar status="failed" reasonText={runStates.failed.reasonText ?? ''} retryText="附件 inventory.csv 是库存清单……" onRetry={noop}/></State>
          <State label="已停止" source="合成"><RunEndBar status="cancelled" reasonText="你停止了这次运行"/></State>
          <State label="已中断" source="合成"><RunEndBar status="interrupted" reasonText="服务重启导致运行中断"/></State>
        </Section>

        <Section id="context-ring" title="上下文环" columns={3} note="最近一次请求的上下文占用；刻度线是压缩水位，蓝点表示发生过压缩。悬停或聚焦查看剩余量与最近一轮用量。">
          <State label="无数据" source="合成"><Surface><ContextRing usage={usageStates.none}/></Surface></State>
          <State label="正常" source="真实"><Surface><ContextRing usage={usageStates.normal}/></Surface></State>
          <State label="接近水位" source="合成"><Surface><ContextRing usage={usageStates.near}/></Surface></State>
          <State label="已压缩" source="合成"><Surface><ContextRing usage={usageStates.compacted}/></Surface></State>
        </Section>

        <Section id="session-item" title="会话列表项" note="标题一行、时间与状态徽标一行。已完成与已停止不显示徽标；等待启动与运行中共用“运行中”徽标。">
          <div className="w-[288px] max-w-full space-y-3 rounded-lg bg-sidebar p-2">
            <State label="运行中" source="合成"><SessionItem session={sessionItemStates.running} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="等待启动（徽标同运行中）" source="合成"><SessionItem session={sessionItemStates.pending} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="等你回复" source="合成"><SessionItem session={sessionItemStates.waiting} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="失败" source="合成"><SessionItem session={sessionItemStates.failed} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="已中断" source="合成"><SessionItem session={sessionItemStates.interrupted} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="已完成" source="真实"><SessionItem session={sessionItemStates.completed} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="已停止（无徽标）" source="合成"><SessionItem session={sessionItemStates.cancelled} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="选中" source="真实"><SessionItem session={sessionItemStates.completed} isActive onClick={noop} onDelete={noop}/></State>
            <State label="长标题" source="合成"><SessionItem session={sessionItemStates.longTitle} isActive={false} onClick={noop} onDelete={noop}/></State>
          </div>
        </Section>

        <Section id="settings-list" title="设置列表项" columns={2} note="MCP 与 A2A 列表的启用开关、连接状态与配置摘要；工具策略分区是 W7.2 的占位。开发库当前没有配置服务器，这里全部是合成数据。">
          <State label="MCP：已连接、已停用、不可用" source="合成">
            <Surface className="px-4 py-0">
              <ul className="divide-y">
                {settingsListStates.mcp.map((server) => (
                  <McpServerRow key={server.server_name} server={server} onToggle={noop} onDelete={noop}/>
                ))}
              </ul>
            </Surface>
          </State>
          <State label="A2A：已连接、不可用" source="合成">
            <Surface className="px-4 py-0">
              <ul className="divide-y">
                {settingsListStates.a2a.map((server) => (
                  <A2aServerRow key={server.id} server={server} onToggle={noop} onDelete={noop}/>
                ))}
              </ul>
            </Surface>
          </State>
          <State label="工具策略（W7.2 占位）" source="合成">
            <Surface><ToolPolicySection/></Surface>
          </State>
        </Section>

        <Section id="composed" title="组合：真实会话" columns={2} note="同一次走查任务在运行中与完成后的样子：状态条、时间线、计划条与上下文环一起出现。页面布局在阶段二接入数据时重组。">
          <State label="运行中（截到 shell_execute）" source="真实">
            <FixtureClock at={PLAN_TOOL_RUNNING_NOW}>
              <ComposedSession
                items={planToolRunning.timeline}
                statusBar={<RunStatusBar run={planToolRunning.runs[0]} onStop={noop}/>}
                plan={<PlanBar plan={planToolRunning.plan} runStatus="running"/>}
                usage={<ContextRing usage={planToolRunning.usage}/>}
              />
            </FixtureClock>
          </State>
          <State label="已完成" source="真实">
            <FixtureClock at={PLAN_WALKTHROUGH_NOW}>
              <ComposedSession
                items={planWalkthrough.timeline}
                statusBar={<RunStatusBar run={planWalkthrough.runs[0]}/>}
                plan={<PlanBar plan={planWalkthrough.plan} runStatus="completed"/>}
                usage={<ContextRing usage={planWalkthrough.usage}/>}
              />
            </FixtureClock>
          </State>
        </Section>
      </main>
    </div>
  )
}
