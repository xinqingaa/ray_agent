import {useRef, useState, type ReactNode} from 'react'
import {ChevronRight, Copy, FileText, Pencil, Play, Quote, RotateCw} from '@/components/ui/icons'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {menuItem, selectedTextWithin, type MenuEntry} from '@/lib/context-menu-policy'
import {copyText} from '@/lib/clipboard'
import type {FileView, RunView, StreamingDraft, TimelineItem} from '@/lib/session-view'
import {foldSettledRuns, foldSummary, groupProcessBlocks, processBlockOpen, processSettled, processSummary, type FoldedRow, type ProcessBlock, type RunFold, type TimelineRow} from '@/lib/process-blocks'
import {cn} from '@/lib/utils'
import {formatCostAmounts, formatExactCostAmounts, hasAnyCost, type CostAmounts} from '@/lib/api/usage'
import {ApprovalCard} from './approval-card'
import {AskCard} from './ask-card'
import {DeliveryCard} from './delivery-card'
import {PreviewCard} from './preview-card'
import type {ManagedPreview} from '@/lib/api/managed-previews'
import {NarrationBlock, UserMessage, CopyIconButton} from './messages'
import {DocumentCitedReply} from './document-citations'
import type {KnowledgeReference} from '@/lib/api/types'
import type {DraftReference} from '@/lib/drafts'
import {AttemptNotice, CompactionNotice, ProtectionNotice} from './notices'
import {ReasoningDisclosure} from './reasoning-disclosure'
import {formatFullDateTime, formatMessageTime} from './format'
import {RunReferences} from './run-references'
import {RunEndBar} from './run-end-bar'
import {RunStatusBar} from './status-bar'
import {ToolGroup} from './tool-group'
import {useDeveloperMode} from '@/hooks/use-developer-mode'

export type TimelineHandlers = {
  sessionId?: string
  selectedCallId?: string | null
  onOpenCall?: (callId: string) => void
  onOpenRunDetails?: (runId: string) => void
  onPreviewFile?: (file: FileView) => void
  onFullscreenPreviewFile?: (file: FileView) => void
  onOpenPreview?: (previewId: string) => void
  onOpenPreviewFullscreen?: (previewId: string) => void
  managedPreviews?: ReadonlyMap<string, ManagedPreview>
  onDownloadFile?: (file: FileView) => void
  onDownloadAll?: (files: FileView[]) => void
  onRetry?: (text: string, runId: string) => void
  /** 只给这一次失败显示重试；不传则凡是失败都可重试。 */
  retryRunId?: string | null
  onContinue?: (runId: string) => void
  /** 只给这一次停下/中断/有进度的失败显示继续；不传且传了 onContinue 时则由条目自身决定。 */
  continueRunId?: string | null
  continuingRunId?: string | null
  hasUnconsumedInput?: (runId: string) => boolean
  consumedPlanRuns?: {has: (runId: string) => boolean}
  planAction?: (runId: string) => ReactNode
  hasPriorTools?: (runId: string) => boolean
  onApprove?: (callId: string) => void
  onReject?: (callId: string) => void
  /** 正在提交审批的调用 */
  approvalSubmitting?: {callId: string; decision: 'approve' | 'reject'} | null
  /** W6：正在增量生成的条目 id */
  streamingItemId?: string | null
  /** 工作区会话：在最终回复下展示本次参考 */
  showRunReferences?: boolean
  onToggleReferences?: (trigger: HTMLButtonElement, open: boolean, settled?: boolean) => void
  workspaceId?: string
  sourceRefresh?: number
  onOpenSource?: (reference: KnowledgeReference) => void
  onQuoteSource?: (reference: DraftReference) => void
  renderMemoryNotice?: (runId: string) => ReactNode
  renderRunActions?: (runId: string) => ReactNode
  /** 把回复里选中的文字以引用形式放进输入框；没有输入框时不给出回复的引用项 */
  quoteText?: (text: string) => void
  /** 把用户消息的文字填回输入框；没有输入框时不给出该项 */
  fillDraft?: (text: string) => void
}

/** 引用为 Markdown 块引用：每行加 `> `，便于在输入框里继续编辑。 */
export function quoteAsMarkdown(text: string) {
  return text.split('\n').map(line => `> ${line}`).join('\n')
}

/**
 * Agent 回复（最终回复与旁白）的菜单。复制全文与 Markdown 原文；有选中文字时先给复制选中与引用到输入框。
 * 回复内的链接、代码块等更内层的表面先接管右键。
 */
function ReplyMenu({text, quote, children}: {text: string; quote?: (text: string) => void; children: ReactNode}) {
  const body = useRef<HTMLDivElement>(null)
  const entries = (): MenuEntry[] => {
    const node = body.current
    const selected = node ? selectedTextWithin(node).trim() : ''
    const plain = node?.querySelector('.markdown-content')?.textContent || text
    return [
      ...(selected ? [
        menuItem('复制选中内容', Copy, () => copyText(selected)),
        ...(quote ? [menuItem('引用到输入框', Quote, () => quote(quoteAsMarkdown(selected)))] : []),
        {type: 'separator'} as const,
      ] : []),
      menuItem('复制全文', Copy, () => copyText(plain)),
      menuItem('复制为 Markdown', FileText, () => copyText(text)),
    ]
  }
  return <ContextMenuSurface items={entries}><div ref={body} className="contents">{children}</div></ContextMenuSurface>
}

/** 按条目类型分派到对应组件；会话页与组件状态目录共用 */
export function TimelineItemView({item, handlers = {}, metrics, runActions, run, showTurnReasoning = false}: {item: TimelineItem; handlers?: TimelineHandlers; metrics?: ReactNode; runActions?: ReactNode; run?: RunView; showTurnReasoning?: boolean}) {
  const streaming = handlers.streamingItemId === item.id
  switch (item.kind) {
    case 'user': {
      const entries: MenuEntry[] = [
        ...(item.text ? [menuItem('复制', Copy, () => copyText(item.text))] : []),
        ...(item.text && handlers.fillDraft ? [menuItem('填回输入框', Pencil, () => handlers.fillDraft?.(item.text))] : []),
      ]
      return <ContextMenuSurface items={entries}><div className="contents"><UserMessage text={item.text} at={item.at} skillName={item.skill?.id} skillVersion={item.skill?.version} runId={item.runId ?? undefined} workspaceId={handlers.workspaceId} attachments={item.attachments} injected={item.injected} onPreview={handlers.onPreviewFile} onDownload={handlers.onDownloadFile}/></div></ContextMenuSurface>
    }
    case 'narration':
      return <ReplyMenu text={item.text} quote={handlers.quoteText}><NarrationBlock text={item.text} streaming={streaming} deliveredFiles={item.deliveredFiles} onDownloadFile={handlers.onDownloadFile}/></ReplyMenu>
    case 'tools':
      return <ToolGroup calls={item.calls} selectedCallId={handlers.selectedCallId} onOpen={handlers.onOpenCall}/>
    case 'ask':
      return <AskCard question={item.question} answered={item.answered}/>
    case 'approval': {
      const submitting = handlers.approvalSubmitting?.callId === item.call.callId ? handlers.approvalSubmitting.decision : null
      return (
        <ApprovalCard
          call={item.call}
          status={item.status}
          decidedAt={item.decidedAt}
          submitting={submitting}
          onApprove={handlers.onApprove ? () => handlers.onApprove?.(item.call.callId) : undefined}
          onReject={handlers.onReject ? () => handlers.onReject?.(item.call.callId) : undefined}
          onOpen={handlers.onOpenCall ? () => handlers.onOpenCall?.(item.call.callId) : undefined}
        />
      )
    }
    case 'delivery':
      return (
        <DeliveryCard
          files={item.files}
          note={item.note}
          onPreview={handlers.onPreviewFile}
          onFullscreenPreview={handlers.onFullscreenPreviewFile}
          onDownload={handlers.onDownloadFile}
          onDownloadAll={handlers.onDownloadAll}
        />
      )
    case 'preview':
      return (
        <PreviewCard
          name={item.name}
          previewKind={item.previewKind}
          note={item.note}
          live={handlers.managedPreviews?.get(item.previewId) ?? null}
          onOpen={handlers.onOpenPreview ? () => handlers.onOpenPreview?.(item.previewId) : undefined}
          onOpenFullscreen={handlers.onOpenPreviewFullscreen ? () => handlers.onOpenPreviewFullscreen?.(item.previewId) : undefined}
        />
      )
    case 'compaction':
      return (
        <CompactionNotice
          beforeTokens={item.beforeTokens}
          afterTokens={item.afterTokens}
          summarizedTurns={item.summarizedTurns}
          trigger={item.trigger}
        />
      )
    case 'attempt':
      return <AttemptNotice attempt={item.attempt} reason={item.reason} retried={item.retried} chars={item.chars}/>
    case 'protection':
      return <ProtectionNotice message={item.message} state={item.state}/>
    case 'final': {
      const finalTurn = showTurnReasoning && run?.turns.length ? run.turns[run.turns.length - 1] : undefined
      const timeText = !streaming ? formatMessageTime(item.at) : ''
      const fullTime = formatFullDateTime(item.at)
      const replyMeta = !streaming && (timeText || item.text) ? (
        <span className="inline-flex items-center gap-1">
          {timeText && (
            <time className="text-xs text-faint tabular-nums" dateTime={item.at ? new Date(item.at).toISOString() : undefined} title={fullTime}>
              {timeText}
            </time>
          )}
          {item.text && (
            <CopyIconButton
              text={item.text}
              label="复制回复"
              className="opacity-0 transition-opacity duration-(--motion-fast) group-hover/final:opacity-100 group-focus-within/final:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
            />
          )}
        </span>
      ) : null
      const hasRunRefs = Boolean(handlers.showRunReferences && item.runId && !streaming)
      return (
        <ReplyMenu text={item.text} quote={handlers.quoteText}>
          <div className="group/final min-w-0 space-y-2">
            <span id={item.runId ? `reply-${item.runId}` : undefined} className="block scroll-mt-3"/>
            {finalTurn && (
              <ReasoningDisclosure
                content={finalTurn.reasoningContent}
                reasoningTokens={finalTurn.usage?.reasoning}
                modelMs={finalTurn.modelMs}
              />
            )}
            <DocumentCitedReply text={item.text} summary={item.summary} streaming={streaming} deliveredFiles={item.deliveredFiles}
              onDownloadFile={handlers.onDownloadFile} runId={item.runId} workspaceId={handlers.workspaceId}
              onOpen={handlers.onOpenSource} onQuote={handlers.onQuoteSource} sourceRefresh={handlers.sourceRefresh}/>
            {hasRunRefs ? <RunReferences runId={item.runId!} replyText={item.text}
              workspaceId={handlers.workspaceId} onOpenSource={handlers.onOpenSource} sourceRefresh={handlers.sourceRefresh}
              onToggle={handlers.onToggleReferences}
              memoryNotice={handlers.renderMemoryNotice?.(item.runId!)}
              actions={<>{replyMeta}{runActions}</>} metrics={metrics}/>
              : replyMeta && <div className="flex items-center gap-2 pt-0.5">{replyMeta}</div>}
          </div>
        </ReplyMenu>
      )
    }
    case 'run_end': {
      const planConsumed = item.status === 'failed' && !!item.runId && !!handlers.consumedPlanRuns?.has(item.runId)
      const hasUnconsumed = !!item.runId && !!handlers.hasUnconsumedInput?.(item.runId)
      const onRetry = handlers.onRetry && (handlers.retryRunId == null || handlers.retryRunId === item.runId) ? (text: string) => handlers.onRetry?.(text, item.runId ?? '') : undefined
      const onContinue = handlers.onContinue && item.runId && (handlers.continueRunId == null || handlers.continueRunId === item.runId)
        ? () => handlers.onContinue?.(item.runId!)
        : undefined
      // 与终态条的重试按钮同一条件：失败、未被计划接受、非未消费输入、有原文可重发
      const retryText = item.status === 'failed' && !planConsumed && !hasUnconsumed && onRetry && item.retryText ? item.retryText : null
      const entries: MenuEntry[] = []
      if (onContinue) entries.push(menuItem('继续任务', Play, onContinue))
      if (retryText && onRetry) entries.push(menuItem('重试', RotateCw, () => onRetry(retryText)))
      return <ContextMenuSurface items={entries}><div className="contents"><RunEndBar status={item.status} reasonText={item.reasonText} retryText={item.retryText}
        planAction={item.runId && handlers.planAction?.(item.runId)} priorTools={!!item.runId && handlers.hasPriorTools?.(item.runId)}
        planConsumed={planConsumed} hasUnconsumedInput={hasUnconsumed} onContinue={onContinue}
        continuing={!!item.runId && handlers.continuingRunId === item.runId} onRetry={onRetry}/></div></ContextMenuSurface>
    }
  }
}

function ProcessBlockView({block, settled, streaming, handlers, liveCost, run}: {block: ProcessBlock; settled: boolean; streaming: boolean; handlers?: TimelineHandlers; liveCost?: CostAmounts; run?: RunView}) {
  const {visibility} = useDeveloperMode()
  const [override, setOverride] = useState<boolean | null>(null)
  const open = processBlockOpen(settled, override, streaming)
  const panelId = `process-${block.id}`
  const turn = block.turnIndex != null ? run?.turns.find(t => t.index === block.turnIndex) : undefined
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOverride(!open)}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-left text-meta text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} aria-hidden/>
        <span className="min-w-0 truncate">{processSummary(block, {counts: visibility.toolCounts, narration: !open})}</span>
        {hasAnyCost(liveCost) && <span className="shrink-0 text-faint tabular-nums" title={`已完成模型请求的估算费用：${formatExactCostAmounts(liveCost)}`}>· ≈{formatCostAmounts(liveCost)}</span>}
      </button>
      {open && (
        <div id={panelId} className="mt-2 flex flex-col gap-3">
          {turn && (
            <ReasoningDisclosure
              content={turn.reasoningContent}
              reasoningTokens={turn.usage?.reasoning}
              modelMs={turn.modelMs}
            />
          )}
          {block.items.map(item => <TimelineItemView key={item.id} item={item} handlers={handlers} run={run}/>)}
        </div>
      )}
    </div>
  )
}

function RowView({row, items, handlers, liveCost, run, showFinalReasoning}: {row: TimelineRow; items: TimelineItem[]; handlers?: TimelineHandlers; liveCost?: CostAmounts; run?: RunView; showFinalReasoning?: boolean}) {
  if (row.type === 'item') return <TimelineItemView item={row.item} handlers={handlers} run={run} showTurnReasoning={showFinalReasoning}/>
  return (
    <ProcessBlockView
      block={row.block}
      settled={processSettled(items, row.block)}
      streaming={row.block.items.some(item => item.id === handlers?.streamingItemId)}
      handlers={handlers}
      liveCost={liveCost}
      run={run}
    />
  )
}

function RunFoldView({fold, items, handlers, runsById}: {fold: RunFold; items: TimelineItem[]; handlers?: TimelineHandlers; runsById: ReadonlyMap<string, RunView>}) {
  const {visibility} = useDeveloperMode()
  const [open, setOpen] = useState(false)
  const panelId = fold.id
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-left text-meta text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} aria-hidden/>
        <span className="min-w-0 truncate">{foldSummary(fold, visibility.toolCounts)}</span>
      </button>
      {open && (
        <ol id={panelId} className="mt-2 ml-[13px] flex flex-col gap-3 border-l pl-3">
          {fold.rows.map(row => {
            const rId = row.type === 'process' ? row.block.runId : row.item.runId
            return <li key={row.type === 'process' ? row.block.id : row.item.id}><RowView row={row} items={items} handlers={handlers} run={rId ? runsById.get(rId) : undefined}/></li>
          })}
        </ol>
      )}
    </div>
  )
}

/** 时间线：同一轮的旁白和工具组收成过程块，运行中逐轮展开；运行结束后按连续过程段默认收起，保留提问、用户补充与交付的先后顺序，最终回复始终可见 */
export function Timeline({items, runs = [], streaming, activeStatus, handlers, className, showCost, sessionCost}: {
  items: TimelineItem[]
  runs?: RunView[]
  streaming?: StreamingDraft | null
  activeStatus?: ReactNode
  showCost?: boolean
  sessionCost?: CostAmounts | number | null
  handlers?: TimelineHandlers
  className?: string
}) {
  const rows = foldSettledRuns(groupProcessBlocks(items))
  const positions = new Map<string, {last: number; final?: number; end?: number}>()
  rows.forEach((row, index) => {
    const runId = row.type === 'fold' ? row.fold.runId : row.type === 'process' ? row.block.runId : row.item.runId
    if (!runId) return
    const position = positions.get(runId) ?? {last: index}
    position.last = index
    if (row.type === 'item' && row.item.kind === 'final') position.final = index
    if (row.type === 'item' && row.item.kind === 'run_end') position.end = index
    positions.set(runId, position)
  })
  const anchors = new Map<number, RunView>()
  const unanchored: RunView[] = []
  for (const run of runs) {
    const position = positions.get(run.id)
    if (!position) {
      if (run.status === 'running' || run.status === 'waiting') unanchored.push(run)
      continue
    }
    const anchor = run.status === 'completed' ? position.final ?? position.last
      : run.status === 'running' || run.status === 'waiting' ? position.last
      : position.end ?? position.final ?? position.last
    anchors.set(anchor, run)
  }
  const liveCost = (run: RunView | undefined): CostAmounts | undefined => {
    if (!showCost || (run?.status !== 'running' && run?.status !== 'waiting')) return undefined
    const amounts: CostAmounts = {usd: run.costNanos ?? null, cny: run.costCnyNanos ?? null}
    return hasAnyCost(amounts) ? amounts : undefined
  }
  const metrics = (run: RunView, costInProcess = false) => (
    // 同一运行保持同一个列表 key，移动到最新过程/最终回复时保留已观察到的速度。
    // 进行中的状态词靠左、统计靠右，共用一行。
    <li key={`run-metrics:${run.id}`} className="flex flex-wrap items-center gap-x-3">
      {(run.status === 'running' || run.status === 'waiting') && activeStatus ? <div className="min-w-0 flex-1">{activeStatus}</div> : null}
      {!costInProcess && liveCost(run) != null && <span className="text-xs text-faint tabular-nums" title={`已完成模型请求的估算费用：${formatExactCostAmounts(liveCost(run))}`}>≈{formatCostAmounts(liveCost(run))}</span>}
      {handlers?.renderRunActions?.(run.id)}
      <RunStatusBar run={run} streaming={streaming} showCost={showCost} sessionCost={sessionCost} className="ml-auto"
        onOpenDetails={handlers?.onOpenRunDetails}/>
    </li>
  )
  const runsById = new Map(runs.map(r => [r.id, r]))
  const processTurnKeys = new Set<string>()
  const collectProcessTurns = (row: FoldedRow) => {
    if (row.type === 'process' && row.block.runId && row.block.turnIndex != null) {
      processTurnKeys.add(`${row.block.runId}:${row.block.turnIndex}`)
    } else if (row.type === 'fold') {
      row.fold.rows.forEach(collectProcessTurns)
    }
  }
  rows.forEach(collectProcessTurns)
  const shouldShowFinalReasoning = (rowRun: RunView | undefined, runId: string | null | undefined) => {
    if (!runId || !rowRun?.turns.length) return false
    const lastTurn = rowRun.turns[rowRun.turns.length - 1]
    return !processTurnKeys.has(`${runId}:${lastTurn.index}`)
  }

  return (
    <ol className={className ?? 'flex min-w-0 flex-col gap-3.5'}>
      {rows.flatMap((row, index) => {
        const run = anchors.get(index)
        const itemRunId = row.type === 'item' ? row.item.runId : row.type === 'process' ? row.block.runId : row.fold.runId
        const itemRun = itemRunId ? runsById.get(itemRunId) : run
        if (run?.status === 'completed' && row.type === 'item' && row.item.kind === 'final' && row.item.runId &&
            handlers?.showRunReferences && handlers.streamingItemId !== row.item.id) {
          return <li key={row.item.id}><TimelineItemView item={row.item} handlers={handlers}
            run={itemRun} showTurnReasoning={shouldShowFinalReasoning(itemRun, row.item.runId)}
            runActions={handlers.renderRunActions?.(run.id)}
            metrics={<RunStatusBar run={run} streaming={streaming} showCost={showCost} sessionCost={sessionCost}
              onOpenDetails={handlers.onOpenRunDetails}/>}/></li>
        }
        const content = row.type === 'fold' ? (
          <li key={row.fold.id}><RunFoldView fold={row.fold} items={items} handlers={handlers} runsById={runsById}/></li>
        ) : (
          <li key={row.type === 'process' ? row.block.id : row.item.id}><RowView row={row} items={items} handlers={handlers} liveCost={liveCost(run)} run={itemRun} showFinalReasoning={row.type === 'item' && row.item.kind === 'final' ? shouldShowFinalReasoning(itemRun, row.item.runId) : false}/></li>
        )
        return run ? [content, metrics(run, row.type === 'process')] : [content]
      })}
      {unanchored.map(run => metrics(run))}
    </ol>
  )
}
