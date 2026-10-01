'use client'

import {AttachmentCopyStatus} from './project-copy-status'
import {CornerDownRight} from 'lucide-react'
import {MarkdownContent} from '@/components/markdown-content'
import {cn} from '@/lib/utils'
import type {FileView, RunSummary} from '@/lib/session-view'
import {fileIcon} from './file-icon'
import {formatBytes, formatDuration, formatTokens, totalTokens} from './format'

type UserMessageProps = {
  text: string
  attachments?: FileView[]
  /** 运行中发送、作为补充要求注入当前运行 */
  injected?: boolean
  className?: string
}

export function UserMessage({text, attachments = [], injected = false, className}: UserMessageProps) {
  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      {injected && (
        <span className="inline-flex items-center gap-1 text-xs text-signal">
          <CornerDownRight className="size-3" aria-hidden/>
          补充要求，已加入当前运行
        </span>
      )}
      <div
        className={cn(
          'max-w-[min(36rem,88%)] rounded-lg px-3.5 py-2.5',
          injected ? 'border border-dashed border-signal/50 bg-signal-soft/40' : 'bg-secondary',
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => {
              const Icon = fileIcon(file.extension)
              return (
                <span key={file.id} className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden/>
                  <span className="truncate">{file.filename}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
                  <AttachmentCopyStatus attachmentId={file.id}/>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

type StreamingProps = {
  /** W6 增量渲染入口：为 true 时文本仍在增长，末尾显示输入光标 */
  streaming?: boolean
}

/** 增量生成时在最后一个块的末尾显示静态光标（不闪烁，动画只留给状态条） */
const STREAMING_CARET = "[&_.markdown-content>:last-child]:after:ml-0.5 [&_.markdown-content>:last-child]:after:text-foreground/60 [&_.markdown-content>:last-child]:after:content-['▍']"

/** 旁白：伴随工具调用的助手文本，比最终回复弱一级 */
export function NarrationBlock({text, streaming, className}: {text: string; className?: string} & StreamingProps) {
  return (
    <div
      className={cn('text-muted-foreground [&_p]:text-meta [&_li]:text-meta', streaming && STREAMING_CARET, className)}
      aria-busy={streaming || undefined}
    >
      <MarkdownContent content={text}/>
    </div>
  )
}

export function RunSummaryLine({summary, className}: {summary: RunSummary; className?: string}) {
  const items: Array<[string, string]> = [
    ['用时', formatDuration(summary.durationMs)],
    ['轮次', String(summary.turns)],
    ['工具调用', String(summary.toolCalls)],
    ['tokens', formatTokens(totalTokens(summary.tokens))],
  ]
  return (
    <dl className={cn('flex flex-wrap gap-x-5 gap-y-1 text-xs', className)} aria-label="运行汇总">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

type FinalReplyProps = {
  text: string
  summary?: RunSummary | null
  className?: string
} & StreamingProps

/** 最终回复：没有工具调用的助手消息，下方附所属运行的汇总 */
export function FinalReply({text, summary, streaming, className}: FinalReplyProps) {
  return (
    <div className={cn('space-y-3', className)} aria-busy={streaming || undefined}>
      <div className={cn(streaming && STREAMING_CARET)}>
        <MarkdownContent content={text}/>
      </div>
      {summary && !streaming && <RunSummaryLine summary={summary} className="border-t pt-2"/>}
    </div>
  )
}
