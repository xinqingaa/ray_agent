import {Clock3, Coins, Gauge, Repeat2, type UiIcon} from '@/components/ui/icons'
import {useState, type ReactNode} from 'react'
import {cn} from '@/lib/utils'
import {formatEstimatedCost} from '@/lib/api/usage'
import type {RunView, StreamingDraft, TurnView} from '@/lib/session-view'
import {resolveOutputRate, type OutputRate} from '@/lib/session-projection'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {useNow} from './clock'
import {formatCount, formatDuration, formatTime, formatTokens, totalTokens, usageSummary} from './format'
import {runPhase, type RunPhase} from './status-meta'

type RunStatusBarProps = {
  /** 这条统计所属的运行 */
  run: RunView | null
  streaming?: StreamingDraft | null
  showCost?: boolean
  sessionCost?: number | null
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
  const head = 'px-1 py-1.5 text-right font-medium first:pl-2 first:text-left last:pr-2'
  const cell = 'px-1 py-1.5 text-right first:pl-2 first:text-left last:pr-2'
  return <div className="text-xs">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-meta font-semibold">本次运行</span>
      <span className="tabular-nums text-muted-foreground">{formatTime(run.startedAt)} 开始 · 共 {elapsedText(elapsed)}</span>
    </div>
    {run.turns.length ? <div className="mt-2 max-h-56 overflow-auto rounded-[10px] bg-muted/55">
      <table className="w-full border-collapse tabular-nums">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr><th className={head}>轮次</th><th className={head}>模型耗时</th><th className={head}>首字</th><th className={head}>输出</th><th className={head}>tok/s</th>{tools && <th className={head}>工具</th>}</tr>
        </thead>
        <tbody>{run.turns.map(turn => {
          const open = turn.endedAt == null && !ended
          const model = open ? now != null ? now - turn.startedAt : null
            : turn.modelMs ?? (turn.endedAt != null ? turn.endedAt - turn.startedAt : null)
          return <tr key={turn.index} className="even:bg-background/50">
            <td className={cn(cell, 'text-muted-foreground')}>{turn.index}</td>
            <td className={cell}>{open ? <span className="text-state-running">{formatDuration(model)}</span> : formatDuration(model)}</td>
            <td className={cell}>{formatDuration(turn.ttftMs)}</td>
            <td className={cell}>{formatTokens(turn.usage?.completion)}</td>
            <td className={cell}>{rateText(open ? liveRate : turnRate(turn))}</td>
            {tools && <td className={cell}>{turn.toolsMs ? formatDuration(turn.toolsMs) : '—'}</td>}
          </tr>
        })}</tbody>
      </table>
    </div> : <p className="py-3 text-muted-foreground">还没有模型请求</p>}
    <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
      <dt className="text-faint">速度</dt><dd>{speedNote}</dd>
      {ended && <><dt className="text-faint">用量</dt><dd className="tabular-nums">{usageSummary(tokens)}</dd></>}
    </dl>
  </div>
}

function Stat({icon: Icon, title, children, secondary, detailsOpen}: {icon?: UiIcon; title: string; children: ReactNode; secondary?: boolean; detailsOpen: boolean}) {
  const [hint, setHint] = useState(false)
  return <Tooltip delayDuration={480} open={!detailsOpen && hint} onOpenChange={value => setHint(value && !detailsOpen)}>
    <TooltipTrigger asChild><span className={cn('inline-flex items-center gap-1', secondary && 'run-stat-secondary')}>
      {Icon && <Icon aria-hidden className="size-[13px] shrink-0 text-faint"/>}{children}
    </span></TooltipTrigger>
    <TooltipContent side="bottom" sideOffset={6} tone="contrast" className="whitespace-pre-line">{title}</TooltipContent>
  </Tooltip>
}

/** 简洁统计独立于开发者模式；本次消耗只在运行进入终态后显示，点开查看逐轮明细。 */
export function RunStatusBar({run, streaming, className, showCost, sessionCost}: RunStatusBarProps) {
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
  const periods: Record<string, string> = {peak: '高峰', off_peak: '低谷', standard: '标准', custom: '自定义'}
  const cost = run.costNanos != null ? formatEstimatedCost(run.costNanos) : '—'
  const costVisible = showCost && ended && (run.costNanos != null || run.turns.some(turn => turn.usage))
  const costDetail = ['估算费用', run.model, run.pricePeriods?.map(period => periods[period] ?? period).join('、'),
    `输入 ${formatTokens(tokens.prompt)}（缓存命中 ${formatTokens(tokens.cached)}） · 输出 ${formatTokens(tokens.completion)}`,
    `本对话累计 ${formatEstimatedCost(sessionCost)}`, '实际金额以服务商账单为准'].filter(Boolean).join('\n')
  const liveCached = cached && run.turns.at(-1)?.index === cached.turn ? cached.rate : null
  const label = [`本次运行用时 ${elapsedText(elapsed)}`, `${turnCount} 轮`, `${speed} tokens 每秒，${speedNote}`,
    ...(ended ? [`已记录 ${total != null ? formatCount(total) : '未知'} tokens`] : []),
    ...(costVisible ? [`估算费用 ${cost}`] : [])].join('，')

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
              className="-mr-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-lg px-1 py-1 text-xs tabular-nums text-faint outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground">
              <Stat icon={Clock3} title="本次运行用时" detailsOpen={open}><time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{elapsedText(elapsed)}</time></Stat>
              <Stat icon={Repeat2} title="模型请求轮次" detailsOpen={open}>{turnCount} 轮</Stat>
              <Stat icon={Gauge} title={`输出速度（${speedNote}）`} detailsOpen={open} secondary>{speed} tok/s</Stat>
              {ended && <Stat title={`本次运行已记录 ${total != null ? formatCount(total) : '未知'} Token`} detailsOpen={open} secondary>{formatTokens(total)}</Stat>}
              {costVisible && <Stat icon={Coins} title={costDetail} detailsOpen={open}>{run.costNanos != null ? '≈' + cost : cost}</Stat>}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" sideOffset={8} align="center" collisionPadding={12}
            className="w-[340px] max-w-[calc(100vw-24px)] rounded-[14px] border-0 bg-background px-3.5 py-3 shadow-(--float-shadow)">
            <RunBreakdown run={run} now={now} liveRate={currentRate ?? liveCached} elapsed={elapsed} speedNote={speedNote} ended={ended}/>
            {costVisible && <p className="mt-2 border-t pt-2 text-xs whitespace-pre-line text-muted-foreground">{costDetail}</p>}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
