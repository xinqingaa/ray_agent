import {useState, type ReactNode} from 'react'
import {Clock3, Coins, Gauge, Repeat2, type LucideIcon} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {RunView, StreamingDraft, TurnView} from '@/lib/session-view'
import {resolveOutputRate, type OutputRate} from '@/lib/session-projection'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {useNow} from './clock'
import {formatCount, formatDuration, formatTime, formatTokens, totalTokens, usageSummary} from './format'
import {runPhase, type RunPhase} from './status-meta'

type RunStatusBarProps = {
  /** 这条统计所属的运行 */
  run: RunView | null
  streaming?: StreamingDraft | null
  className?: string
}

const LIVE_PHASES: RunPhase[] = ['preparing_environment', 'model', 'tool', 'waiting_reply', 'waiting_approval', 'stopping']

function elapsedText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`
}

function rateText(rate: OutputRate | null | undefined): string {
  return rate ? rate.tokensPerSecond < 1 ? '<1' : String(Math.round(rate.tokensPerSecond)) : '—'
}

function turnRate(turn: TurnView): OutputRate | null {
  return resolveOutputRate({turnEnded: true, modelMs: turn.modelMs, ttftMs: turn.ttftMs,
    completionTokens: turn.usage?.completion, reasoningTokens: turn.usage?.reasoning})
}

/** 逐轮明细：模型耗时、首字延迟、输出与速度分开列出，不由其中一项推算其他项。 */
function RunBreakdown({run, now, liveRate, elapsed, speedNote, ended}: {
  run: RunView; now: number | null; liveRate: OutputRate | null; elapsed: number | null; speedNote: string; ended: boolean
}) {
  const {visibility} = useDeveloperMode()
  const tools = visibility.toolMetrics
  const tokens = run.summary?.tokens ?? run.tokens
  const head = 'px-2 py-1.5 text-right font-medium first:pl-3 first:text-left last:pr-3'
  const cell = 'px-2 py-1.5 text-right first:pl-3 first:text-left last:pr-3'
  return <div className="text-xs">
    <div className="flex items-baseline justify-between gap-3 border-b px-3 py-2.5">
      <span className="text-meta font-medium">本次运行</span>
      <span className="tabular-nums text-muted-foreground">{formatTime(run.startedAt)} 开始 · 共 {elapsedText(elapsed)}</span>
    </div>
    {run.turns.length ? <div className="max-h-64 overflow-y-auto">
      <table className="w-full border-collapse tabular-nums">
        <thead className="sticky top-0 bg-popover text-faint">
          <tr><th className={head}>轮次</th><th className={head}>模型</th><th className={head}>首字</th><th className={head}>输出</th><th className={head}>tok/s</th>{tools && <th className={head}>工具</th>}</tr>
        </thead>
        <tbody>{run.turns.map(turn => {
          const open = turn.endedAt == null && !ended
          const model = open ? now != null ? now - turn.startedAt : null
            : turn.modelMs ?? (turn.endedAt != null ? turn.endedAt - turn.startedAt : null)
          return <tr key={turn.index} className="border-t border-border/60">
            <td className={cn(cell, 'text-muted-foreground')}>{turn.index}</td>
            <td className={cell}>{open ? <span className="text-state-running">{formatDuration(model)}</span> : formatDuration(model)}</td>
            <td className={cell}>{formatDuration(turn.ttftMs)}</td>
            <td className={cell}>{formatTokens(turn.usage?.completion)}</td>
            <td className={cell}>{rateText(open ? liveRate : turnRate(turn))}</td>
            {tools && <td className={cell}>{turn.toolsMs ? formatDuration(turn.toolsMs) : '—'}</td>}
          </tr>
        })}</tbody>
      </table>
    </div> : <p className="px-3 py-3 text-muted-foreground">还没有模型请求</p>}
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t px-3 py-2.5 text-muted-foreground">
      <dt className="text-faint">速度</dt><dd>{speedNote}</dd>
      {ended && <><dt className="text-faint">用量</dt><dd className="tabular-nums">{usageSummary(tokens)}</dd></>}
    </dl>
  </div>
}

function Stat({icon: Icon, title, children}: {icon: LucideIcon; title: string; children: ReactNode}) {
  return <span className="inline-flex items-center gap-1" title={title}>
    <Icon aria-hidden className="size-3 shrink-0 text-faint transition-colors group-hover/stats:text-muted-foreground group-data-[state=open]/stats:text-muted-foreground"/>
    {children}
  </span>
}

/** 简洁统计独立于开发者模式；本次消耗只在运行进入终态后显示，点开查看逐轮明细。 */
export function RunStatusBar({run, streaming, className}: RunStatusBarProps) {
  const phase = runPhase(run?.status, run?.activity)
  const live = LIVE_PHASES.includes(phase)
  const [open, setOpen] = useState(false)
  const now = useNow(live && run != null)
  const currentStream = streaming?.runId === run?.id ? streaming : null
  const currentRate = currentStream ? resolveOutputRate({
    text: currentStream.text,
    elapsedMs: now != null && currentStream.startedAt != null ? now - currentStream.startedAt : null,
  }) : null
  const rateValue = currentRate?.tokensPerSecond
  const streamRunId = currentStream?.runId
  const streamTurn = currentStream?.turn
  const streamAttempt = currentStream?.attempt
  const [lastStreamRate, setLastStreamRate] = useState<{runId: string; turn: number; attempt?: number; rate: OutputRate} | null>(null)
  // 完整助手消息会替换临时文本；工具等待期间保留最后一次观察到的生成速度。
  if (streamRunId && streamTurn != null && rateValue != null && (
    lastStreamRate?.runId !== streamRunId || lastStreamRate.turn !== streamTurn ||
    lastStreamRate.attempt !== streamAttempt || lastStreamRate.rate.tokensPerSecond !== rateValue
  )) {
    setLastStreamRate({runId: streamRunId, turn: streamTurn, attempt: streamAttempt,
      rate: {tokensPerSecond: rateValue, estimated: true}})
  }
  if (!run) return null

  const ended = run.endedAt != null || ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)
  const elapsed = ended ? run.summary?.durationMs ?? (run.endedAt != null ? run.endedAt - run.startedAt : null)
    : now != null ? now - run.startedAt : null
  const turnCount = run.summary?.turns ?? run.turns.length
  const planMode = run.mode === 'plan'
  const cached = lastStreamRate?.runId === run.id ? lastStreamRate : null
  let recent: {turn: number; rate: OutputRate} | null = null
  for (const turn of [...run.turns].reverse()) {
    if (turn.endedAt == null) continue
    const rate = turnRate(turn)
    if (rate) {recent = {turn: turn.index, rate}; break}
  }
  const rate = currentRate ?? (cached && (!recent || cached.turn > recent.turn) ? cached.rate : recent?.rate ?? cached?.rate)
  const speed = rateText(rate)
  const speedNote = rate?.estimated ? '按可见文本估算' : rate ? '最近一轮输出速度，不含工具等待' : '尚无速度'
  const tokens = run.summary?.tokens ?? run.tokens
  const total = totalTokens(tokens)
  const liveCached = cached && run.turns.at(-1)?.index === cached.turn ? cached.rate : null
  const label = [`本次运行用时 ${elapsedText(elapsed)}`, `${turnCount} 轮`, `${speed} tokens 每秒，${speedNote}`,
    ...(ended ? [`已记录 ${total != null ? formatCount(total) : '未知'} tokens`] : [])].join('，')

  return (
    <div className={cn('shrink-0', className)}>
      <div className="flex min-h-8 items-center justify-end gap-3 py-1">
        {planMode && (
          <span className="shrink-0 rounded-sm bg-signal-soft px-1.5 py-0.5 text-xs font-medium text-signal">
            计划模式
          </span>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={`${label}。查看各轮明细`}
              className="group/stats -mr-1.5 flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1 rounded-md px-2 py-1 text-xs tabular-nums text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground">
              <Stat icon={Clock3} title="本次运行用时"><time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{elapsedText(elapsed)}</time></Stat>
              <Stat icon={Repeat2} title="模型请求轮次">{turnCount} 轮</Stat>
              <Stat icon={Gauge} title={`输出速度，${speedNote}`}>{speed} tok/s</Stat>
              {ended && <Stat icon={Coins} title={`本次运行已记录 ${total != null ? formatCount(total) : '未知'} tokens`}>{formatTokens(total)} tokens</Stat>}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[24rem] max-w-[calc(100vw-2rem)] p-0">
            <RunBreakdown run={run} now={now} liveRate={currentRate ?? liveCached} elapsed={elapsed} speedNote={speedNote} ended={ended}/>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
