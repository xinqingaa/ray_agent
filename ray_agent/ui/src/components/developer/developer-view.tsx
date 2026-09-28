'use client'

import {useEffect, useMemo, useState} from 'react'
import {Download} from 'lucide-react'
import {Button} from '@/components/ui/button'
import type {TurnRequest} from '@/lib/api/types'
import type {ContextEstimate, RawEvent, RunView, SessionView, TurnView} from '@/lib/session-view'
import {cn} from '@/lib/utils'
import {formatDuration, formatTime, formatTokens, totalTokens} from '@/components/run/format'

type DeveloperViewProps = {
  view: SessionView
  loadTurnRequest: (runId: string, index: number) => Promise<TurnRequest>
  className?: string
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function eventSummary(ev: RawEvent): string {
  const p = ev.payload
  switch (ev.type) {
    case 'message':
      return `${textOf(p.role) || '消息'} ${clip(textOf(p.message), 72)}`.trim()
    case 'tool':
      return [textOf(p.function) || textOf(p.function_name) || textOf(p.name), textOf(p.status)].filter(Boolean).join(' ')
    case 'run':
      return [textOf(p.status), textOf(p.reason)].filter(Boolean).join(' ')
    case 'turn':
      return `第 ${String(p.index ?? '?')} 轮 ${textOf(p.phase)}`
    case 'plan':
      return '计划更新'
    case 'error':
      return clip(textOf(p.error) || textOf(p.message), 80)
    case 'wait':
      return textOf(p.reason) || '等待'
    case 'done':
      return '运行结束'
    case 'title':
      return clip(textOf(p.title), 80)
    case 'context':
    case 'compact':
      return '上下文压缩'
    case 'attempt':
      return `第 ${String(p.attempt ?? '?')} 次尝试 ${textOf(p.reason)}`
    default:
      return ev.type
  }
}

const BAR = [
  {key: 'system', label: '系统提示', className: 'bg-signal'},
  {key: 'tools', label: '工具定义', className: 'bg-signal/65'},
  {key: 'history', label: '历史', className: 'bg-foreground/40'},
  {key: 'toolResults', label: '工具结果', className: 'bg-state-waiting'},
] as const

function ContextBar({estimate}: {estimate: ContextEstimate | null}) {
  if (!estimate) return <p className="text-xs text-faint">这一轮没有上下文构成</p>
  const parts = BAR.map((item) => ({...item, value: estimate[item.key]}))
  const total = parts.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) return <p className="text-xs text-faint">上下文构成为 0</p>
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-sm" aria-hidden>
        {parts.map((item) => (
          <span key={item.key} className={item.className} style={{width: `${(item.value / total) * 100}%`}}/>
        ))}
      </div>
      <p className="sr-only">
        {parts.map((item) => `${item.label} ${item.value}`).join('，')}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        {parts.map((item) => (
          <li key={item.key}>
            <span className={cn('mr-1 inline-block size-1.5 rounded-sm align-middle', item.className)} aria-hidden/>
            {item.label} {formatTokens(item.value)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function messageBody(message: Record<string, unknown>): string {
  const content = message.content ?? message.message
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const rec = part as Record<string, unknown>
        if (typeof rec.text === 'string') return rec.text
        if (typeof rec.content === 'string') return rec.content
      }
      return JSON.stringify(part)
    }).join('\n')
  }
  return JSON.stringify(message, null, 2)
}

function TurnRequestPanel({request, loading, error}: {request: TurnRequest | null; loading: boolean; error: string | null}) {
  if (loading) return <p className="text-meta text-muted-foreground">正在读取这一轮发给模型的请求</p>
  if (error) return <p className="text-meta text-state-failed">{error}</p>
  if (!request) return <p className="text-meta text-faint">选择一轮后，这里显示模型实际收到的消息。</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        运行 {request.run_id.slice(0, 8)} · 第 {request.index} 轮 · {request.messages.length} 条消息 · {request.tools.length} 个工具定义
      </p>
      <ol className="flex flex-col gap-2">
        {request.messages.map((message, i) => {
          const role = typeof message.role === 'string' ? message.role : 'message'
          const body = messageBody(message)
          return (
            <li key={i} className="rounded-md border bg-card px-3 py-2">
              <p className="mb-1 font-mono text-xs text-muted-foreground">{role}</p>
              <pre className="max-h-48 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap break-all">
                {body.length > 6000 ? `${body.slice(0, 6000)}…` : body}
              </pre>
            </li>
          )
        })}
      </ol>
      {request.tools.length > 0 && (
        <details className="rounded-md border bg-card px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">工具定义 {request.tools.length} 个</summary>
          <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(request.tools, null, 2).slice(0, 8000)}
          </pre>
        </details>
      )}
    </div>
  )
}

function turnDuration(turn: TurnView): string {
  if (turn.endedAt == null) return '进行中'
  return formatDuration(turn.endedAt - turn.startedAt)
}

export function DeveloperView({view, loadTurnRequest, className}: DeveloperViewProps) {
  const types = useMemo(() => {
    const set = new Set(view.events.map((ev) => ev.type))
    return [...set].sort()
  }, [view.events])
  const [typeFilter, setTypeFilter] = useState('all')
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const [selected, setSelected] = useState<{runId: string; index: number} | null>(null)
  const [request, setRequest] = useState<TurnRequest | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const events = typeFilter === 'all' ? view.events : view.events.filter((ev) => ev.type === typeFilter)
  const compactions = view.timeline.filter((item) => item.kind === 'compaction')
  const selectedKey = selected ? `${selected.runId}:${selected.index}` : null
  const requestLoading = selectedKey != null && loadedKey !== selectedKey
  const shownRequest = loadedKey === selectedKey ? request : null
  const shownError = loadedKey === selectedKey ? requestError : null

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    const key = `${selected.runId}:${selected.index}`
    loadTurnRequest(selected.runId, selected.index).then((next) => {
      if (cancelled) return
      setRequest(next)
      setRequestError(null)
      setLoadedKey(key)
    }).catch((err: unknown) => {
      if (cancelled) return
      setRequest(null)
      setRequestError(err instanceof Error ? err.message : '读不到这一轮的请求')
      setLoadedKey(key)
    })
    return () => {
      cancelled = true
    }
  }, [selected, loadTurnRequest])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({runs: view.runs, events: view.events}, null, 2)], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${view.id}-runs-events.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={cn('flex flex-col gap-6 px-4 py-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">开发者视图</h2>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          事件类型
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-7 rounded-md border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">全部</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" onClick={exportJson}>
          <Download aria-hidden/>
          下载运行与事件
        </Button>
      </div>

      <section aria-label="事件流">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">事件</h3>
        {view.events.length === 0 ? (
          <p className="text-meta text-faint">这里会按序号列出事件。任务开始后出现。</p>
        ) : (
          <div className="overflow-auto rounded-lg border">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">序号</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">时间</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">类型</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">运行</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">摘要</th>
                  <th scope="col" className="px-2 py-1.5 font-medium"><span className="sr-only">原文</span></th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const open = openSeq === ev.seq
                  return (
                    <tr key={ev.seq} className="border-t align-top">
                      <td className="px-2 py-1.5 tabular-nums">{ev.seq}</td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{formatTime(ev.createdAt)}</td>
                      <td className="px-2 py-1.5 font-mono">{ev.type}</td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{ev.runId ? ev.runId.slice(0, 8) : '—'}</td>
                      <td className="px-2 py-1.5">
                        <div>{eventSummary(ev)}</div>
                        {open && (
                          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap break-all">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenSeq(open ? null : ev.seq)}
                          className="rounded-sm text-signal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={open}
                        >
                          {open ? '收起' : '原文'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="轮次">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">轮次</h3>
        {view.runs.length === 0 ? (
          <p className="text-meta text-faint">每一轮的用时、用量和上下文构成会出现在这里。模型开始请求后出现。</p>
        ) : view.runs.map((run) => (
          <RunTurns
            key={run.id}
            run={run}
            selected={selected}
            onSelect={(index) => setSelected({runId: run.id, index})}
          />
        ))}
        {(selected || request || requestLoading || requestError) && (
          <div className="mt-3">
            <TurnRequestPanel request={shownRequest} loading={requestLoading} error={shownError}/>
          </div>
        )}
      </section>

      <section aria-label="压缩">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">压缩</h3>
        {compactions.length === 0 ? (
          <p className="text-meta text-faint">还没有压缩。上下文超过水位时，这里列出前后估算量和摘要全文。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {compactions.map((item) => (
              <li key={item.id} className="rounded-md border bg-card px-3 py-2 text-meta">
                <p className="tabular-nums">
                  {formatTokens(item.beforeTokens)} → {formatTokens(item.afterTokens)} tokens
                  {item.summarizedTurns > 0 && `，摘要了 ${item.summarizedTurns} 轮`}
                </p>
                {item.summary ? (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{item.summary}</pre>
                ) : (
                  <p className="mt-1 text-xs text-faint">这次压缩没有摘要全文</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function RunTurns({
  run,
  selected,
  onSelect,
}: {
  run: RunView
  selected: {runId: string; index: number} | null
  onSelect: (index: number) => void
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 font-mono text-xs text-muted-foreground">
        运行 {run.id.slice(0, 8)} · {run.status}
      </p>
      {run.turns.length === 0 ? (
        <p className="text-xs text-faint">这次运行还没有轮次记录</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {run.turns.map((turn) => {
            const active = selected?.runId === run.id && selected.index === turn.index
            const tokens = totalTokens(turn.usage)
            return (
              <li key={turn.index}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(turn.index)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'border-signal/40 bg-signal-soft/40' : 'bg-card hover:bg-muted/50',
                  )}
                >
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs tabular-nums">
                    <span className="font-medium text-foreground">第 {turn.index} 轮</span>
                    <span>用时 {turnDuration(turn)}</span>
                    <span>模型 {formatDuration(turn.modelMs)}</span>
                    <span>工具 {formatDuration(turn.toolsMs)}</span>
                    <span>tokens {formatTokens(tokens)}</span>
                    <span>结束原因 {turn.finishReason ?? '—'}</span>
                    {turn.ttftMs != null && <span>首字 {formatDuration(turn.ttftMs)}</span>}
                    {turn.attempts != null && <span>尝试 {turn.attempts}</span>}
                  </span>
                  <span className="mt-1.5 block">
                    <ContextBar estimate={turn.contextEstimate}/>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
