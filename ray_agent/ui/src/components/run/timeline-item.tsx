'use client'

import {useState, type ReactNode} from 'react'
import {ChevronRight} from 'lucide-react'
import type {FileView, RunView, StreamingDraft, TimelineItem} from '@/lib/session-view'
import {foldSettledRuns, foldSummary, groupProcessBlocks, processBlockOpen, processSettled, processSummary, type ProcessBlock, type RunFold, type TimelineRow} from '@/lib/process-blocks'
import {cn} from '@/lib/utils'
import {ProjectCopiesProvider} from './project-copy-status'
import {ApprovalCard} from './approval-card'
import {AskCard} from './ask-card'
import {DeliveryCard, SessionDeliveryCopies} from './delivery-card'
import {FinalReply, NarrationBlock, UserMessage} from './messages'
import {AttemptNotice, CompactionNotice, ProtectionNotice} from './notices'
import {RunEndBar} from './run-end-bar'
import {RunStatusBar} from './status-bar'
import {ToolGroup} from './tool-group'
import {useDeveloperMode} from '@/hooks/use-developer-mode'

export type TimelineHandlers = {
  projectId?: string
  sessionId?: string
  selectedCallId?: string | null
  onOpenCall?: (callId: string) => void
  onPreviewFile?: (file: FileView) => void
  onDownloadFile?: (file: FileView) => void
  onDownloadAll?: (files: FileView[]) => void
  onRetry?: (text: string, runId: string) => void
  /** 只给这一次失败显示重试；不传则凡是失败都可重试。 */
  retryRunId?: string | null
  onApprove?: (callId: string) => void
  onReject?: (callId: string) => void
  /** 正在提交审批的调用 */
  approvalSubmitting?: {callId: string; decision: 'approve' | 'reject'} | null
  /** W6：正在增量生成的条目 id */
  streamingItemId?: string | null
}

/** 按条目类型分派到对应组件；会话页与组件状态目录共用 */
export function TimelineItemView({item, handlers = {}}: {item: TimelineItem; handlers?: TimelineHandlers}) {
  const streaming = handlers.streamingItemId === item.id
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} attachments={item.attachments} injected={item.injected} onPreview={handlers.onPreviewFile} onDownload={handlers.onDownloadFile}/>
    case 'narration':
      return <NarrationBlock text={item.text} streaming={streaming} deliveredFiles={item.deliveredFiles} onDownloadFile={handlers.onDownloadFile}/>
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
          projectId={handlers.projectId}
          files={item.files}
          note={item.note}
          onPreview={handlers.onPreviewFile}
          onDownload={handlers.onDownloadFile}
          onDownloadAll={handlers.onDownloadAll}
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
    case 'final':
      return <FinalReply text={item.text} summary={item.summary} streaming={streaming} deliveredFiles={item.deliveredFiles} onDownloadFile={handlers.onDownloadFile}/>
    case 'run_end':
      return <RunEndBar status={item.status} reasonText={item.reasonText} retryText={item.retryText} onRetry={handlers.onRetry && (handlers.retryRunId == null || handlers.retryRunId === item.runId) ? (text) => handlers.onRetry?.(text, item.runId ?? '') : undefined}/>
  }
}

function ProcessBlockView({block, settled, streaming, handlers}: {block: ProcessBlock; settled: boolean; streaming: boolean; handlers?: TimelineHandlers}) {
  const {visibility} = useDeveloperMode()
  const [override, setOverride] = useState<boolean | null>(null)
  const open = processBlockOpen(settled, override, streaming)
  const panelId = `process-${block.id}`
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
      </button>
      {open && (
        <div id={panelId} className="mt-2 flex flex-col gap-3">
          {block.items.map(item => <TimelineItemView key={item.id} item={item} handlers={handlers}/>)}
        </div>
      )}
    </div>
  )
}

function RowView({row, items, handlers}: {row: TimelineRow; items: TimelineItem[]; handlers?: TimelineHandlers}) {
  if (row.type === 'item') return <TimelineItemView item={row.item} handlers={handlers}/>
  return (
    <ProcessBlockView
      block={row.block}
      settled={processSettled(items, row.block)}
      streaming={row.block.items.some(item => item.id === handlers?.streamingItemId)}
      handlers={handlers}
    />
  )
}

function RunFoldView({fold, items, handlers}: {fold: RunFold; items: TimelineItem[]; handlers?: TimelineHandlers}) {
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
          {fold.rows.map(row => (
            <li key={row.type === 'process' ? row.block.id : row.item.id}><RowView row={row} items={items} handlers={handlers}/></li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** 时间线：同一轮的旁白和工具组收成过程块，运行中逐轮展开；运行结束后按连续过程段默认收起，保留提问、用户补充与交付的先后顺序，最终回复始终可见 */
export function Timeline({items, runs = [], streaming, activeStatus, handlers, className}: {
  items: TimelineItem[]
  runs?: RunView[]
  streaming?: StreamingDraft | null
  activeStatus?: ReactNode
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
  const metrics = (run: RunView) => (
    // 同一运行保持同一个列表 key，移动到最新过程/最终回复时保留已观察到的速度。
    <li key={`run-metrics:${run.id}`}>
      {(run.status === 'running' || run.status === 'waiting') && activeStatus}
      <RunStatusBar run={run} streaming={streaming}/>
    </li>
  )
  return (
    <ProjectCopiesProvider projectId={handlers?.projectId}><ol className={className ?? 'flex flex-col gap-3'}>
      {rows.flatMap((row, index) => {
        const content = row.type === 'fold' ? (
          <li key={row.fold.id}><RunFoldView fold={row.fold} items={items} handlers={handlers}/></li>
        ) : (
          <li key={row.type === 'process' ? row.block.id : row.item.id}><RowView row={row} items={items} handlers={handlers}/></li>
        )
        const run = anchors.get(index)
        return run ? [content, metrics(run)] : [content]
      })}
      {unanchored.map(metrics)}
      <SessionDeliveryCopies sessionId={handlers?.sessionId} items={items} onPreview={handlers?.onPreviewFile} onDownload={handlers?.onDownloadFile} onDownloadAll={handlers?.onDownloadAll}/>
    </ol></ProjectCopiesProvider>
  )
}
