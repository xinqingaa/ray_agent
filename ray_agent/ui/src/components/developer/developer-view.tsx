'use client'

import {useEffect, useMemo, useState} from 'react'
import {ChevronDown, Download, ListFilter} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {TurnRequest} from '@/lib/api/types'
import type {ContextEstimate, RawEvent, RunView, SessionView, TurnView, UsageView} from '@/lib/session-view'
import {resolveOutputRate, type OutputRate} from '@/lib/session-projection'
import {cn} from '@/lib/utils'
import {formatDuration, formatTime, formatTokens, usageSummary} from '@/components/run/format'

type DeveloperViewProps = {
  view: SessionView
  loadTurnRequest: (runId: string, index: number) => Promise<TurnRequest>
  className?: string
}

type TurnRequestResult = {request: TurnRequest | null; error: string | null}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const EVENT_LABELS: Record<string, string> = {
  approval: '审批',
  attempt: '模型尝试',
  cleanup: '清理',
  compact: '上下文压缩',
  context: '上下文变更',
  project_notes: '项目笔记',
  done: '结束',
  error: '错误',
  message: '消息',
  plan: '计划',
  run: '运行',
  title: '标题',
  tool: '工具',
  turn: '轮次',
  wait: '等待',
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
    case 'context': {
      const op = textOf(p.op)
      if (op === 'append') return `追加上下文${typeof p.message_count === 'number' ? ` · ${p.message_count} 条消息` : ''}`
      if (op === 'strip_reasoning') return '清理历史推理字段'
      if (op === 'replace') return '替换模型上下文'
      return '上下文变更'
    }
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

function RawEventDetail({event, open, rendered}: {event: RawEvent; open: boolean; rendered: boolean}) {
  return (
    <div
      id={`event-raw-${event.seq}`}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        'overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out motion-reduce:transition-none',
        open ? 'mt-2 max-h-72 opacity-100' : 'mt-0 max-h-0 opacity-0',
      )}
    >
      {rendered && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap break-all">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function DeveloperView({view, loadTurnRequest, className}: DeveloperViewProps) {
  const types = useMemo(() => {
    const set = new Set(view.events.map((ev) => ev.type))
    return [...set].sort()
  }, [view.events])
  const [typeFilter, setTypeFilter] = useState('all')
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const [visitedSeqs, setVisitedSeqs] = useState<Set<number>>(() => new Set())
  const [selected, setSelected] = useState<{runId: string; index: number} | null>(null)
  const [visitedTurnKeys, setVisitedTurnKeys] = useState<Set<string>>(() => new Set())
  const [requestByKey, setRequestByKey] = useState<Record<string, TurnRequestResult>>({})

  const events = typeFilter === 'all' ? view.events : view.events.filter((ev) => ev.type === typeFilter)
  const filterLabel = typeFilter === 'all' ? '全部事件' : EVENT_LABELS[typeFilter] ?? typeFilter
  const compactions = view.timeline.filter((item) => item.kind === 'compaction')

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    const key = `${selected.runId}:${selected.index}`
    loadTurnRequest(selected.runId, selected.index).then((next) => {
      if (cancelled) return
      setRequestByKey((current) => ({...current, [key]: {request: next, error: null}}))
    }).catch((err: unknown) => {
      if (cancelled) return
      setRequestByKey((current) => ({
        ...current,
        [key]: {request: null, error: err instanceof Error ? err.message : '读不到这一轮的请求'},
      }))
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
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <h2 className="text-sm font-medium">开发者视图</h2>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5" aria-label={`筛选事件类型，当前：${filterLabel}`}>
                <ListFilter aria-hidden/>
                {filterLabel}
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">事件类型</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={typeFilter} onValueChange={setTypeFilter}>
                <DropdownMenuRadioItem value="all">全部事件 <span className="ml-auto tabular-nums text-xs text-muted-foreground">{view.events.length}</span></DropdownMenuRadioItem>
                {types.map((type) => (
                  <DropdownMenuRadioItem key={type} value={type}>
                    {EVENT_LABELS[type] ?? type}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">{type}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden/>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5" onClick={exportJson}>
            <Download aria-hidden/>
            导出 JSON
          </Button>
        </div>
      </div>

      <section aria-label="事件流">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">事件</h3>
        {view.events.length === 0 ? (
          <p className="text-meta text-faint">这里会按序号列出事件。任务开始后出现。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[46rem] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-16"/>
                <col className="w-24"/>
                <col className="w-28"/>
                <col className="w-24"/>
                <col/>
                <col className="w-16"/>
              </colgroup>
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">序号</th>
                  <th scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">时间</th>
                  <th scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">类型</th>
                  <th scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">运行</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">摘要</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium"><span className="sr-only">原文</span></th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const open = openSeq === ev.seq
                  return (
                    <tr key={ev.seq} className="border-t align-top">
                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{ev.seq}</td>
                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-muted-foreground">{formatTime(ev.createdAt)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap" title={ev.type}>{EVENT_LABELS[ev.type] ?? ev.type}</td>
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap text-muted-foreground">{ev.runId ? ev.runId.slice(0, 8) : '—'}</td>
                      <td className="px-2 py-1.5">
                        <div className="break-words">{eventSummary(ev)}</div>
                        <RawEventDetail event={ev} open={open} rendered={open || visitedSeqs.has(ev.seq)}/>
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            if (!open) setVisitedSeqs((current) => new Set(current).add(ev.seq))
                            setOpenSeq(open ? null : ev.seq)
                          }}
                          className="inline-flex whitespace-nowrap rounded-sm text-signal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={open}
                          aria-controls={`event-raw-${ev.seq}`}
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
            visitedTurnKeys={visitedTurnKeys}
            requestByKey={requestByKey}
            onSelect={(index) => {
              setVisitedTurnKeys((current) => new Set(current).add(`${run.id}:${index}`))
              setSelected((current) => current?.runId === run.id && current.index === index ? null : {runId: run.id, index})
            }}
          />
        ))}
      </section>

      <section aria-label="压缩">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">压缩</h3>
        <ContextBudget usage={view.usage}/>
        {compactions.length === 0 ? (
          <p className="text-meta text-faint">还没有压缩。上下文超过压缩阈值时，这里列出前后估算量和摘要全文。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {compactions.map((item) => (
              <li key={item.id} className="rounded-md border bg-card px-3 py-2 text-meta">
                <p className="tabular-nums">
                  {item.trigger === 'manual' ? '手动' : item.trigger === 'overflow' ? '溢出' : '阈值'} ·{' '}
                  {formatTokens(item.beforeTokens)} → {formatTokens(item.afterTokens)} tokens
                  {item.summarizedTurns > 0 && `，摘要了 ${item.summarizedTurns} 轮`}
                  {item.runId == null && ' · 会话级'}
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

function ContextBudget({usage}: {usage: UsageView}) {
  const ctx = usage.context
  if (!ctx) return null
  const snapshot = ctx.snapshotAt != null ? new Date(ctx.snapshotAt).toLocaleString() : '—'
  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta tabular-nums">
      <dt className="text-muted-foreground">可用输入上限</dt><dd>{formatTokens(ctx.inputLimit)}</dd>
      <dt className="text-muted-foreground">输出预留</dt><dd>{formatTokens(ctx.maxTokens)}</dd>
      <dt className="text-muted-foreground">安全余量</dt><dd>{formatTokens(ctx.safetyTokens)}</dd>
      <dt className="text-muted-foreground">快照时间</dt><dd>{snapshot}</dd>
    </dl>
  )
}

function speedNote(turn: TurnView, rate: OutputRate): string | undefined {
  if (rate.estimated) return '没有可用的 completion tokens，这是按字符估算的速度'
  const notes: string[] = []
  if ((turn.attempts ?? 1) > 1) notes.push('用时含失败尝试，数值偏小')
  if (turn.usage?.reasoning != null) notes.push('已从 completion tokens 中扣除推理 token')
  return notes.length > 0 ? notes.join('。') : undefined
}

function formatSpeed(tokensPerSecond: number): string {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond < 0) return '—'
  if (tokensPerSecond > 0 && tokensPerSecond < 1) return '<1'
  return String(Math.round(tokensPerSecond))
}

function TurnSpeed({turn}: {turn: TurnView}) {
  if (turn.endedAt == null) return null
  const rate = resolveOutputRate({
    turnEnded: true,
    modelMs: turn.modelMs,
    ttftMs: turn.ttftMs ?? null,
    completionTokens: turn.usage?.completion ?? null,
    reasoningTokens: turn.usage?.reasoning ?? null,
  })
  if (!rate) return null
  return (
    <span title={speedNote(turn, rate)}>
      {rate.estimated ? '速度（估算）' : '速度'} {formatSpeed(rate.tokensPerSecond)} tok/s
    </span>
  )
}

function RunTurns({
  run,
  selected,
  visitedTurnKeys,
  requestByKey,
  onSelect,
}: {
  run: RunView
  selected: {runId: string; index: number} | null
  visitedTurnKeys: Set<string>
  requestByKey: Record<string, TurnRequestResult>
  onSelect: (index: number) => void
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 font-mono text-xs text-muted-foreground">
        运行 {run.id.slice(0, 8)} · {run.status}
        {run.mode === 'plan' && ' · 计划模式'}
      </p>
      {run.turns.length === 0 ? (
        <p className="text-xs text-faint">这次运行还没有轮次记录</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {run.turns.map((turn) => {
            const active = selected?.runId === run.id && selected.index === turn.index
            const key = `${run.id}:${turn.index}`
            const panelId = `turn-request-${run.id}-${turn.index}`
            const result = requestByKey[key]
            return (
              <li key={turn.index}>
                <button
                  type="button"
                  aria-expanded={active}
                  aria-controls={panelId}
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
                    <span>{usageSummary(turn.usage)}</span>
                    <span>结束原因 {turn.finishReason ?? '—'}</span>
                    {turn.ttftMs != null && <span>首字 {formatDuration(turn.ttftMs)}</span>}
                    {turn.attempts != null && <span>尝试 {turn.attempts}</span>}
                    <TurnSpeed turn={turn}/>
                    <ChevronDown className={cn('ml-auto size-3.5 self-center transition-transform duration-200 motion-reduce:transition-none', active && 'rotate-180')} aria-hidden/>
                  </span>
                  <span className="mt-1.5 block">
                    <ContextBar estimate={turn.contextEstimate}/>
                  </span>
                </button>
                <div
                  id={panelId}
                  aria-hidden={!active}
                  inert={!active}
                  className={cn(
                    'grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none',
                    active ? 'mt-2 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    {visitedTurnKeys.has(key) && (
                      <div className="ml-2 border-l pl-3">
                        <TurnRequestPanel request={result?.request ?? null} loading={!result} error={result?.error ?? null}/>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
