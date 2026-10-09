'use client'

import {useId, useState} from 'react'
import {ChevronRight} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {ToolCallView} from '@/lib/session-view'
import {ToolCard} from './tool-card'
import {TONE_TEXT, type Tone} from './status-meta'
import {useDeveloperMode} from '@/hooks/use-developer-mode'

type ToolGroupProps = {
  calls: ToolCallView[]
  selectedCallId?: string | null
  onOpen?: (callId: string) => void
  defaultCollapsed?: boolean
  className?: string
}

function groupStatus(calls: ToolCallView[]): {tone: Tone; text: string} {
  const count = (s: ToolCallView['status']) => calls.filter((c) => c.status === s).length
  const running = count('running')
  const failed = count('failed')
  const ok = count('succeeded')
  const other = calls.length - running - failed - ok
  if (running > 0) return {tone: 'running', text: `进行中，已完成 ${calls.length - running}/${calls.length}`}
  if (failed > 0) return {tone: 'failed', text: `${failed} 个未成功${ok ? `，${ok} 个成功` : ''}${other ? `，${other} 个未完成` : ''}`}
  if (other > 0) return {tone: 'stopped', text: `${ok} 个成功，${other} 个未执行或被取消`}
  return {tone: 'success', text: '全部成功'}
}

/** 同一轮的多个工具调用：分组标题显示数量与整体状态，可整体折叠 */
export function ToolGroup({calls, selectedCallId, onOpen, defaultCollapsed = false, className}: ToolGroupProps) {
  const {visibility} = useDeveloperMode()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const listId = useId()

  if (calls.length === 1) {
    return <ToolCard call={calls[0]} selected={selectedCallId === calls[0].callId} onOpen={onOpen} className={className}/>
  }

  const status = groupStatus(calls)

  return (
    <div className={cn('rounded-md', className)}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => setCollapsed((v) => !v)}
        className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 text-faint transition-transform', !collapsed && 'rotate-90')} aria-hidden/>
        <span className="text-xs font-medium text-muted-foreground">{visibility.toolCounts ? `${calls.length} 个操作` : '操作记录'}</span>
        <span className={cn('text-xs', TONE_TEXT[status.tone])}>{status.text}</span>
      </button>
      <div id={listId} hidden={collapsed} className="relative ml-[13px] border-l pl-1.5">
        {calls.map((call) => (
          <ToolCard key={call.callId} call={call} selected={selectedCallId === call.callId} onOpen={onOpen}/>
        ))}
      </div>
    </div>
  )
}
