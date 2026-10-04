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
import {AttemptNotice, CompactingNotice, CompactionNotice} from '@/components/run/notices'
import {RunEndBar, PlanExecuteBar} from '@/components/run/run-end-bar'
import {PlusCommandMenu} from '@/components/input-command-menu'
import {ProjectWorkspaceCatalog} from '@/components/dev/project-workspace-catalog'
import {ProjectUploadTreeCatalog} from '@/components/dev/project-upload-tree-catalog'
import {ProjectPicker} from '@/components/project-picker'
import {ContextRing} from '@/components/run/context-ring'
import type {CommandContext} from '@/lib/commands'
import {Timeline} from '@/components/run/timeline-item'
import {McpServerRow} from '@/components/settings/mcp-section'
import {A2aServerRow} from '@/components/settings/a2a-section'
import {ToolPolicySection, type ToolPolicyForm} from '@/components/settings/tool-policy-section'
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
  projectPickerStates,
  projectWorkbenchNotes,
  toolGroups,
  toolStates,
  usageStates,
} from '@/fixtures/states'

type Source = '真实' | '合成'

const SECTIONS = [
  ['project-workspace', 'W11 工作区主路径'],
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
  ['input-commands', '输入命令'],
  ['project-upload-tree', '项目导入审核树'],
  ['project-picker', '项目选择器'],
  ['project-workbench', '项目与变更页'],
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
      <div className="max-h-[560px] overflow-y-auto px-4 py-4">
        <Timeline items={items} handlers={{selectedCallId: selected, onOpenCall: setSelected}}/>
      </div>
      <div className="space-y-2 border-t bg-card/60 p-3">
        {plan}
        {statusBar}
        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-meta text-faint">
          <span>输入框（阶段二接入）</span>
          {usage}
        </div>
      </div>
    </div>
  )
}

const noop = () => toast.info('目录页中的操作不会调用接口')

const commandIdle: CommandContext = {
  hasSession: true,
  hasRuns: true,
  runStatus: 'idle',
  waitingApproval: false,
  waitingReply: false,
  submitting: false,
  uploading: false,
  compacting: false,
  planMode: false,
  projectsEnabled: true,
  projectBindable: true,
  actions: {openFilePicker: noop, togglePlan: noop, openProjectPicker: noop, compact: noop},
}

const commandRunning: CommandContext = {
  ...commandIdle,
  runStatus: 'running',
}

const commandNoRuns: CommandContext = {
  ...commandIdle,
  hasRuns: false,
}

const toolPolicyFixture: ToolPolicyForm = {
  load: {phase: 'ready'},
  config: {
    rules: {'mcp:*': 'ask', 'a2a:*': 'ask', 'mcp:qiniu:*': 'allow', shell_execute: 'ask'},
    default_rules: {'mcp:*': 'ask', 'a2a:*': 'ask'},
    fallback: 'allow',
    builtin_toolsets: [
      {toolset: 'file', functions: ['read_file', 'write_file', 'replace_in_file', 'search_in_file', 'find_files']},
      {toolset: 'shell', functions: ['shell_execute', 'shell_read_output', 'shell_wait_process', 'shell_write_input', 'shell_kill_process']},
      {toolset: 'browser', functions: ['browser_view', 'browser_navigate']},
      {toolset: 'search', functions: ['search_web']},
      {toolset: 'deliver', functions: ['deliver_files']},
    ],
  },
  mcpServers: settingsListStates.mcp,
  a2aServers: settingsListStates.a2a,
  rules: {'mcp:*': 'ask', 'a2a:*': 'ask', 'mcp:qiniu:*': 'allow', shell_execute: 'ask'},
  dirty: false,
  saving: false,
  savedAt: null,
  saveError: null,
  setRule: noop,
  restoreDefaults: noop,
  reset: noop,
  save: async () => {
    noop()
  },
  reload: noop,
}

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

        <Section id="status-bar" title="运行状态条" note="放在输入框上方。状态、已用时间、轮次与当前动作。暂停在发送按钮上，状态行不再写「停止」。">
          <State label="空闲" source="真实"><RunStatusBar run={runStates.idle}/></State>
          <State label="模型思考中" source="真实"><FixtureClock at={runStates.modelNow}><RunStatusBar run={runStates.model} /></FixtureClock></State>
          <State label="工具执行中" source="真实"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.tool} /></FixtureClock></State>
          <State label="计划模式" source="合成"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.planMode} /></FixtureClock></State>
          <State label="等待回复" source="真实"><FixtureClock at={runStates.waitingReplyNow}><RunStatusBar run={runStates.waitingReply} /></FixtureClock></State>
          <State label="等待审批" source="合成"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.waitingApproval} /></FixtureClock></State>
          <State label="停止中" source="合成"><FixtureClock at={runStates.toolNow}><RunStatusBar run={runStates.stopping} /></FixtureClock></State>
          <State label="已完成（状态行收起）" source="真实"><Surface className="text-meta text-faint">会话标题显示已完成，运行汇总留在时间线。</Surface></State>
          <State label="失败（含原因）" source="合成"><RunStatusBar run={runStates.failed}/></State>
          <State label="已停止（状态行收起）" source="合成"><Surface className="text-meta text-faint">会话标题显示已停止，停止记录留在时间线。</Surface></State>
          <State label="已中断" source="合成"><RunStatusBar run={runStates.interrupted}/></State>
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

        <Section id="compaction" title="压缩提示" note="W2 合入后由 compact 事件产生；摘要全文在开发者视图。点击压缩后、结果到达前显示转圈的「压缩中」。">
          <State label="压缩中" source="合成"><Surface><CompactingNotice/></Surface></State>
          <State label="一次压缩（自动）" source="合成"><Surface><CompactionNotice beforeTokens={41_236} afterTokens={6_310} summarizedTurns={8} trigger="watermark"/></Surface></State>
          <State label="手动压缩" source="合成"><Surface><CompactionNotice beforeTokens={18_200} afterTokens={9_400} summarizedTurns={4} trigger="manual"/></Surface></State>
        </Section>

        <Section id="attempt" title="失败尝试提示" columns={2} note="W6 的 attempt 事件；失败的请求不进入模型历史。">
          <State label="已重试" source="合成"><Surface><AttemptNotice attempt={1} reason="连接中断，已收到 312 个字符" retried/></Surface></State>
          <State label="最终失败" source="合成"><Surface><AttemptNotice attempt={3} reason="请求超时（120 秒）" retried={false}/></Surface></State>
        </Section>

        <Section id="run-end" title="终态条" note="非 completed 的运行结束方式；失败时可以相同内容再发一次，不删除已有事件。">
          <State label="失败" source="合成"><RunEndBar status="failed" reasonText={runStates.failed.reasonText ?? ''} retryText="附件 inventory.csv 是库存清单……" onRetry={noop}/></State>
          <State label="已停止" source="合成"><RunEndBar status="cancelled" reasonText="你停止了这次运行"/></State>
          <State label="已中断" source="合成"><RunEndBar status="interrupted" reasonText="服务重启导致运行中断"/></State>
          <State label="按计划执行" source="合成"><PlanExecuteBar onExecute={noop}/></State>
        </Section>

        <Section id="context-ring" title="上下文环" columns={3} note="最近一次请求的上下文占用；刻度线是压缩水位，蓝点表示发生过压缩。悬停或聚焦查看剩余量与最近一轮用量。">
          <State label="无数据" source="合成"><Surface><ContextRing usage={usageStates.none}/></Surface></State>
          <State label="正常" source="真实"><Surface><ContextRing usage={usageStates.normal}/></Surface></State>
          <State label="接近水位" source="合成"><Surface><ContextRing usage={usageStates.near}/></Surface></State>
          <State label="已压缩" source="合成"><Surface><ContextRing usage={usageStates.compacted}/></Surface></State>
          <State label="压缩后估算" source="合成"><Surface><ContextRing usage={usageStates.postCompactEstimate}/></Surface></State>
        </Section>

        <Section id="project-upload-tree" title="项目导入审核树" note="合成文件树，支持筛选、键盘导航和确认；不读取本地文件或写入项目。"><ProjectUploadTreeCatalog/></Section>

        <Section id="project-picker" title="项目选择器" columns={2} note="项目从侧栏打开；此处保留选择器的独立状态检查，创建与归档在产品中使用单独入口。">
          <State label="未选择" source="合成">
            <Surface className="inline-flex">
              <ProjectPicker enabled selected={projectPickerStates.unselected} onSelect={noop}/>
            </Surface>
          </State>
          <State label="已选择项目" source="合成">
            <Surface className="inline-flex">
              <ProjectPicker enabled selected={projectPickerStates.selected} onSelect={noop}/>
            </Surface>
          </State>
          <State label="不可用（禁用选择）" source="合成">
            <Surface className="inline-flex">
              <ProjectPicker enabled selected={projectPickerStates.unavailable} onSelect={noop} disabled/>
            </Surface>
          </State>
        </Section>

        <Section id="project-workbench" title="项目页" columns={2} note="绑定项目后出现在工作台；不参与按工具家族自动打开。目录页只展示空态文案。">
          <State label="项目页空态" source="合成">
            <Surface className="text-meta text-faint">{projectWorkbenchNotes.treeEmpty}</Surface>
          </State>
          <State label="标题栏项目不可用" source="合成">
            <p className="text-xs text-muted-foreground">
              {projectPickerStates.unavailable.name} · {projectPickerStates.unavailable.reason}
            </p>
          </State>
        </Section>

        <Section id="input-commands" title="输入命令" columns={2} note="+ 菜单与 / 提示共用注册表；不可用项显示原因。">
          <State label="全部可用" source="合成"><Surface className="inline-flex"><PlusCommandMenu context={commandIdle}/></Surface></State>
          <State label="运行中（Plan 与压缩不可用）" source="合成"><Surface className="inline-flex"><PlusCommandMenu context={commandRunning}/></Surface></State>
          <State label="无运行历史（压缩不可用）" source="合成"><Surface className="inline-flex"><PlusCommandMenu context={commandNoRuns}/></Surface></State>
          <State label="计划模式标记" source="合成">
            <span className="inline-flex h-7 items-center rounded-md border border-signal/30 bg-signal-soft/50 px-2 text-xs font-medium text-signal">
              计划模式
            </span>
          </State>
        </Section>

        <Section id="project-workspace" title="W11 工作区主路径" note="合成设计目录：胶囊切换对话与项目，打开项目不创建对话；列表刷新不重置展开状态。此处不证明产品端到端能力。">
          <ProjectWorkspaceCatalog/>
        </Section>

        <Section id="session-item" title="会话列表项" note="一行：标题在左，时间在右。需要处理的状态替换时间；已完成和已停止只显示时间。选中用弱底和字重。">
          <div className="w-[288px] max-w-full space-y-3 rounded-lg bg-sidebar p-2">
            <State label="运行中" source="合成"><SessionItem session={sessionItemStates.running} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="准备中" source="合成"><SessionItem session={sessionItemStates.pending} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="等你处理（提问或审批）" source="合成"><SessionItem session={sessionItemStates.waiting} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="失败" source="合成"><SessionItem session={sessionItemStates.failed} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="已中断" source="合成"><SessionItem session={sessionItemStates.interrupted} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="已完成" source="真实"><SessionItem session={sessionItemStates.completed} isActive={false} onClick={noop} onDelete={noop}/></State>
            <State label="压缩中" source="合成"><SessionItem session={sessionItemStates.completed} isActive compacting onClick={noop} onDelete={noop}/></State>
            <State label="已停止" source="合成"><SessionItem session={sessionItemStates.cancelled} isActive={false} onClick={noop} onDelete={noop}/></State>
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
          <State label="工具策略：默认规则加一条 MCP 服务器与一条函数规则" source="合成">
            <Surface><ToolPolicySection form={toolPolicyFixture}/></Surface>
          </State>
        </Section>

        <Section id="composed" title="组合：真实会话" columns={2} note="同一次走查任务在运行中与完成后的样子：状态条、时间线、计划条与上下文环一起出现。页面布局在阶段二接入数据时重组。">
          <State label="运行中（截到 shell_execute）" source="真实">
            <FixtureClock at={PLAN_TOOL_RUNNING_NOW}>
              <ComposedSession
                items={planToolRunning.timeline}
                statusBar={<RunStatusBar run={planToolRunning.runs[0]} />}
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
