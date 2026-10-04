'use client'

import type {FileView, TimelineItem} from '@/lib/session-view'
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
      return <UserMessage text={item.text} attachments={item.attachments} injected={item.injected}/>
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

/** 时间线：条目之间按类型留白；数百条时的虚拟化在接入真实数据时处理 */
export function Timeline({items, handlers, className}: {items: TimelineItem[]; handlers?: TimelineHandlers; className?: string}) {
  return (
    <ProjectCopiesProvider projectId={handlers?.projectId}><ol className={className ?? 'flex flex-col gap-3'}>
      {items.map((item) => (
        <li key={item.id}>
          <TimelineItemView item={item} handlers={handlers}/>
        </li>
      ))}
      <SessionDeliveryCopies sessionId={handlers?.sessionId} items={items} onPreview={handlers?.onPreviewFile} onDownload={handlers?.onDownloadFile} onDownloadAll={handlers?.onDownloadAll}/>
    </ol></ProjectCopiesProvider>
  )
}
