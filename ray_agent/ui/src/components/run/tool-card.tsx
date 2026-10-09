'use client'

import {useId, useState} from 'react'
import {ChevronRight, PanelRight} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import type {ToolCallView} from '@/lib/session-view'
import {useNow} from './clock'
import {formatClock, formatCount, formatDuration} from './format'
import {FAMILY, TONE_TEXT, TOOL_STATUS} from './status-meta'
import {useDeveloperMode} from '@/hooks/use-developer-mode'

const ARG_CLAMP = 400
const RESULT_CLAMP = 4000

type ToolCardProps = {
  call: ToolCallView
  /** 当前在工作台中显示的调用 */
  selected?: boolean
  /** 在工作台打开该调用 */
  onOpen?: (callId: string) => void
  defaultExpanded?: boolean
  className?: string
}

/** 结果原文里最值得看的文本：Shell 取最后一条命令的输出，文件取内容，其余为 JSON */
function resultText(call: ToolCallView): string | null {
  const content = call.raw.content
  if (content == null) return null
  if (typeof content === 'string') return content
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (Array.isArray(c.console) && c.console.length > 0) {
      const last = c.console[c.console.length - 1] as {output?: unknown}
      if (typeof last?.output === 'string') return last.output
    }
    if (typeof c.content === 'string') return c.content
  }
  return JSON.stringify(content, null, 2)
}

/** 普通记录保留可读结果，不把协议 JSON 或命令日志作为正文。 */
function readableResult(call: ToolCallView): string | null {
  if (call.family === 'shell') return null
  const content = call.raw.content
  if (typeof content === 'string') return content
  if (!content || typeof content !== 'object') return null
  const envelope = content as Record<string, unknown>
  for (const key of ['content', 'text', 'message']) if (typeof envelope[key] === 'string') return envelope[key] as string
  const outcome = envelope.outcome as {data?: unknown} | undefined
  const payload = outcome?.data ?? content
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return null
  const data = payload as Record<string, unknown>
  for (const key of ['content', 'text', 'message']) if (typeof data[key] === 'string') return data[key] as string
  const results = data.results
  if (!Array.isArray(results)) return outcome?.data != null ? JSON.stringify(payload, null, 2) : null
  return results.map(item => {
    if (!item || typeof item !== 'object') return ''
    const result = item as Record<string, unknown>
    return ['title', 'url', 'snippet', 'description'].flatMap(key => typeof result[key] === 'string' ? [result[key]] : []).join('\n')
  }).filter(Boolean).join('\n\n') || null
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

function ClampedText({text, limit, className}: {text: string; limit: number; className?: string}) {
  const [full, setFull] = useState(false)
  const long = text.length > limit
  return (
    <div className="min-w-0">
      <pre className={cn('whitespace-pre-wrap break-all font-mono text-xs leading-5', className)}>
        {(long && !full ? `${text.slice(0, limit)}…` : text).split(/(https?:\/\/[^\s"'<>\\]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part.replace(/[),.;，。]+$/, '')} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="text-signal underline underline-offset-4">{part}</a> : part)}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          className="mt-1 rounded-sm text-xs text-signal hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {full ? '收起' : `显示全部（${formatCount(text.length)} 字符）`}
        </button>
      )}
    </div>
  )
}

function ToolDetail({call, onOpen}: {call: ToolCallView; onOpen?: (callId: string) => void}) {
  const args = Object.entries(call.raw.args ?? {})
  const text = resultText(call)
  const result = call.result

  return (
    <div className="space-y-3 pt-2 pb-3 pl-7 pr-2 text-meta">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <code className="font-mono">{call.toolset}.{call.name}</code>
        <span className="font-mono text-faint">{call.callId}</span>
        {onOpen && (
          <Button type="button" variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => onOpen(call.callId)}>
            <PanelRight/>
            在工作台查看
          </Button>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-medium text-muted-foreground">参数</h4>
        {args.length === 0 ? (
          <p className="text-xs text-faint">无参数</p>
        ) : (
          <dl className="space-y-1.5 rounded-md bg-muted px-3 py-2">
            {args.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3">
                <dt className="font-mono text-xs leading-5 text-muted-foreground">{key}</dt>
                <dd className="min-w-0">{typeof value === 'string' && /^https?:\/\//.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="break-all text-signal underline underline-offset-4">{value}</a> : <ClampedText text={stringify(value)} limit={ARG_CLAMP}/>}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-medium text-muted-foreground">结果</h4>
        {result?.truncated && (
          <p className="mb-1.5 rounded-md bg-state-waiting-soft px-3 py-1.5 text-xs text-state-waiting">
            交给模型的结果已截断
            {result.rawChars != null && `，原始 ${formatCount(result.rawChars)} 字符`}
            {result.fullOutputPath ? `。完整输出已保存在 ${result.fullOutputPath}` : '。完整输出未保存'}
          </p>
        )}
        {call.status === 'running' ? (
          <p className="text-xs text-faint">调用结束后显示结果</p>
        ) : text == null ? (
          <p className="text-xs text-faint">{result?.error ? '没有结果内容' : '工具没有返回内容'}</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md bg-muted px-3 py-2">
            <ClampedText text={text} limit={RESULT_CLAMP}/>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 工具卡：一行动词摘要，状态、耗时与结果摘要在行内；展开看参数与结果原文。
 * 点击行同时在工作台打开该调用。运行中只走秒，不加动画（动画留给状态条的当前动作）。
 */
export function ToolCard({call, selected, onOpen, defaultExpanded = false, className}: ToolCardProps) {
  const {visibility} = useDeveloperMode()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const detailId = useId()
  const running = call.status === 'running'
  const now = useNow(running)
  const status = TOOL_STATUS[call.status]
  const family = FAMILY[call.family]
  const StatusIcon = status.icon
  const FamilyIcon = family.icon
  const result = call.result
  const url = call.target && /^https?:\/\//.test(call.target) ? call.target : null
  const canOpen = visibility.canInspectTool(call.family)
  const readable = readableResult(call)

  const duration = running
    ? (now != null ? formatClock(now - call.startedAt) : '--:--')
    : call.durationMs != null ? formatDuration(call.durationMs) : ''

  const note =
    call.status === 'failed' || call.status === 'denied' || call.status === 'skipped' || call.status === 'cancelled'
      ? result?.error ?? status.label
      : null

  let summary: string | null = null
  if (call.status === 'succeeded' && result) {
    const parts: string[] = []
    if (result.exitCode != null) parts.push(`退出码 ${result.exitCode}`)
    if (result.summary) parts.push(result.summary)
    summary = parts.join('，') || null
  }

  return (
    <div
      className={cn(
        'group/tool @container/tool rounded-md',
        selected && 'bg-signal-soft/50 ring-1 ring-signal/30',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        onClick={() => {
          setExpanded((v) => !v)
          if (canOpen) onOpen?.(call.callId)
        }}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn('flex size-5 shrink-0 items-center justify-center', TONE_TEXT[status.tone])}>
          <StatusIcon className="size-3.5" strokeWidth={2.5} aria-hidden/>
          <span className="sr-only">{status.label}</span>
        </span>
        <FamilyIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
        <span className="flex min-w-24 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-meta font-medium">{call.verb}</span>
          {call.target && !url && (visibility.toolDetails || call.family !== 'shell') && (
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={call.argSummary || call.target}>
              {call.target}
            </span>
          )}
        </span>
        {visibility.toolMetrics && result?.truncated && call.status === 'succeeded' && (
          <span className="hidden shrink-0 rounded-sm bg-state-waiting-soft px-1.5 text-xs text-state-waiting @md/tool:inline">
            {result.fullOutputPath ? '完整输出已保存' : '结果已截断'}
          </span>
        )}
        {visibility.toolMetrics && summary && <span className="hidden shrink-0 text-xs text-muted-foreground @lg/tool:inline">{summary}</span>}
        {visibility.toolMetrics && <span className={cn('w-14 shrink-0 text-right text-xs tabular-nums', running ? 'text-state-running' : 'text-muted-foreground')}>
          {duration}
        </span>}
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-faint transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
      </button>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="mx-9 mb-2 block truncate text-xs text-signal underline underline-offset-4" title={url} onClick={event => event.stopPropagation()}>{url}</a>}
      {note && !expanded && (
        <p className={cn('pb-1 pl-9 pr-2 text-xs', TONE_TEXT[status.tone])}>{note}</p>
      )}
      {expanded && (
        <div id={detailId}>
          {note && <p className={cn('pl-9 pr-2 text-xs', TONE_TEXT[status.tone])}>{note}</p>}
          {visibility.toolDetails ? <ToolDetail call={call} onOpen={onOpen}/> : <div className="space-y-2 pb-2 pl-9 text-xs text-muted-foreground">
            {result?.truncated && <p>内容未完整展示</p>}
            {readable && <ClampedText text={readable} limit={RESULT_CLAMP}/>}
            {canOpen && onOpen && <Button type="button" variant="ghost" size="xs" onClick={() => onOpen(call.callId)}>查看内容</Button>}
            {!readable && !note && !canOpen && <p>{running ? '正在执行' : status.label}</p>}
          </div>}
        </div>
      )}
    </div>
  )
}
