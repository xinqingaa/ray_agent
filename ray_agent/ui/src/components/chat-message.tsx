'use client'

import { useState } from 'react'
import { cn, formatClockTime, formatDurationBetween } from '@/lib/utils'
import { CheckIcon, ChevronDown } from 'lucide-react'
import { ToolUse } from '@/components/tool-use'
import { AttachmentsMessage } from '@/components/attachments-message'
import { MarkdownContent } from '@/components/markdown-content'
import type { ToolEvent } from '@/lib/api/types'
import { type TimelineItem, type AttachmentFile, formatTaskError, readCreatedAt } from '@/lib/session-events'

export interface ChatMessageProps {
  className?: string
  item: TimelineItem
  onViewAllFiles?: () => void
  onFileClick?: (file: AttachmentFile) => void
  onToolClick?: (tool: ToolEvent) => void
  onRetry?: () => void
  retryDisabled?: boolean
}

function EventTime({
  value,
  className,
}: {
  value?: unknown
  className?: string
}) {
  const label = formatClockTime(value)
  if (!label) return null
  return (
    <span className={cn('text-xs text-gray-400 tabular-nums', className)}>
      {label}
    </span>
  )
}

function ToolRow({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex items-center gap-2 mt-3 w-full min-w-0', className)}>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ChatMessage({
  className,
  item,
  onViewAllFiles,
  onFileClick,
  onToolClick,
  onRetry,
  retryDisabled = false,
}: ChatMessageProps) {
  if (item.kind === 'user') {
    return (
      <div
        className={cn(
          'flex w-full flex-col items-end justify-end gap-1 group mt-3',
          className
        )}
      >
        <div className="flex max-w-[90%] relative flex-col gap-1 items-end">
          <div className="text-gray-700 relative flex items-center rounded-lg overflow-hidden bg-white p-3 border">
            {item.data.message ?? ''}
          </div>
          <EventTime value={readCreatedAt(item.data)} />
        </div>
      </div>
    )
  }

  if (item.kind === 'assistant') {
    return (
      <div
        className={cn('flex flex-col gap-2 w-full group mt-3', className)}
      >
        <div className="max-w-none p-0 m-0 text-gray-700">
          <MarkdownContent content={item.data.message ?? ''} />
        </div>
        {item.showTime && <EventTime value={readCreatedAt(item.data)} />}
      </div>
    )
  }

  if (item.kind === 'tool') {
    return (
      <ToolRow className={className}>
        <ToolUse data={item.data} onClick={onToolClick ? () => onToolClick(item.data) : undefined} />
      </ToolRow>
    )
  }

  if (item.kind === 'step') {
    return (
      <StepBlock stepItem={item} className={className} onToolClick={onToolClick} />
    )
  }

  if (item.kind === 'attachments') {
    return (
      <div className={cn('mt-3', className)}>
        <AttachmentsMessage
          role={item.role}
          files={item.files}
          onViewAllFiles={item.role === 'assistant' ? onViewAllFiles : undefined}
          onFileClick={onFileClick}
        />
      </div>
    )
  }

  if (item.kind === 'error') {
    return (
      <div className={cn('mt-3 rounded-lg border border-red-200 bg-red-50 p-3', className)}>
        <p className="text-sm font-medium text-red-700">任务失败</p>
        <p className="mt-1 text-sm text-red-700 whitespace-pre-wrap">
          {formatTaskError(item.error)}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="mt-2 text-sm font-medium text-red-700 underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            重试
          </button>
        )}
      </div>
    )
  }

  return null
}

function StepBlock({
  stepItem,
  className,
  onToolClick,
}: {
  stepItem: Extract<TimelineItem, { kind: 'step' }>
  className?: string
  onToolClick?: (tool: ToolEvent) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const { data, tools, startedAt, endedAt } = stepItem
  const durationLabel = formatDurationBetween(startedAt, endedAt)

  return (
    <div className={cn('flex flex-col mt-3', className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((prev) => !prev)
          }
        }}
        className="text-sm w-full cursor-pointer flex gap-2 justify-between group/header text-gray-700 rounded-md hover:bg-gray-50/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
      >
        <div className="flex flex-row gap-2 justify-start items-center truncate min-w-0 flex-1">
          <div
            className={cn(
              'w-4 h-4 flex-shrink-0 flex items-center justify-center border rounded-[15px] bg-gray-300'
            )}
          >
            <CheckIcon className="text-white" size={10} />
          </div>
          <div className="truncate font-medium markdown-content min-w-0">
            {data.description}
          </div>
          <ChevronDown
            className={cn('flex-shrink-0 transition-transform text-gray-500', expanded && 'rotate-180')}
          />
        </div>
        {durationLabel && (
          <span className="flex-shrink-0 text-xs text-gray-400 tabular-nums pt-0.5">
            {durationLabel}
          </span>
        )}
      </div>
      {expanded && tools.length > 0 && (
        <div className="flex">
          <div className="w-6 relative flex-shrink-0">
            <div className="absolute left-[7px] top-2 bottom-0 w-[1px] border-l border-dashed border-gray-300" />
          </div>
          <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden pt-2 transition-[max-height,opacity] duration-150 ease-in-out">
            {tools.map((tool, idx) => (
              <ToolRow key={`${data.id}-tool-${idx}`}>
                <ToolUse data={tool} onClick={onToolClick ? () => onToolClick(tool) : undefined} />
              </ToolRow>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}