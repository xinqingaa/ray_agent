'use client'

import {useState} from 'react'
import {ChevronRight} from 'lucide-react'
import type {FileView, TimelineItem} from '@/lib/session-view'
import {groupProcessBlocks, processBlockOpen, processSettled, processSummary, type ProcessBlock} from '@/lib/process-blocks'
import {cn} from '@/lib/utils'
import {ProjectCopiesProvider} from './project-copy-status'
import {ApprovalCard} from './approval-card'
import {AskCard} from './ask-card'
import {DeliveryCard, SessionDeliveryCopies} from './delivery-card'
import {FinalReply, NarrationBlock, UserMessage} from './messages'
import {AttemptNotice, CompactionNotice, ProtectionNotice} from './notices'
import {RunEndBar} from './run-end-bar'
import {ToolGroup} from './tool-group'

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
      return <NarrationBlock text={item.text} streaming={streaming}/>
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
      return <FinalReply text={item.text} summary={item.summary} streaming={streaming}/>
    case 'run_end':
      return <RunEndBar status={item.status} reasonText={item.reasonText} retryText={item.retryText} onRetry={handlers.onRetry && (handlers.retryRunId == null || handlers.retryRunId === item.runId) ? (text) => handlers.onRetry?.(text, item.runId ?? '') : undefined}/>
  }
}

function ProcessBlockView({block, settled, streaming, handlers}: {block: ProcessBlock; settled: boolean; streaming: boolean; handlers?: TimelineHandlers}) {
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
        <span className="min-w-0 truncate">{processSummary(block)}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-2 flex flex-col gap-3">
          {block.items.map(item => <TimelineItemView key={item.id} item={item} handlers={handlers}/>)}
        </div>
      )}
    </div>
  )
}

/** 时间线：同一轮的旁白和工具组收成过程块；运行中展开，结束后收起 */
export function Timeline({items, handlers, className}: {items: TimelineItem[]; handlers?: TimelineHandlers; className?: string}) {
  const rows = groupProcessBlocks(items)
  return (
    <ProjectCopiesProvider projectId={handlers?.projectId}><ol className={className ?? 'flex flex-col gap-3'}>
      {rows.map(row => row.type === 'process' ? (
        <li key={row.block.id}>
          <ProcessBlockView
            block={row.block}
            settled={processSettled(items, row.block)}
            streaming={row.block.items.some(item => item.id === handlers?.streamingItemId)}
            handlers={handlers}
          />
        </li>
      ) : (
        <li key={row.item.id}>
          <TimelineItemView item={row.item} handlers={handlers}/>
        </li>
      ))}
      <SessionDeliveryCopies sessionId={handlers?.sessionId} items={items} onPreview={handlers?.onPreviewFile} onDownload={handlers?.onDownloadFile} onDownloadAll={handlers?.onDownloadAll}/>
    </ol></ProjectCopiesProvider>
  )
}
