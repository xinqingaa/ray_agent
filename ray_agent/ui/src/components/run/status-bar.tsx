import {ArrowRight, Clock3, Coins, Gauge, Repeat2, type UiIcon} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {useRef, useState, type ReactNode} from 'react'
import {cn} from '@/lib/utils'
import {formatEstimatedCost} from '@/lib/api/usage'
import type {RunView, StreamingDraft, TokenCounts, TurnView} from '@/lib/session-view'
import {resolveOutputRate, type OutputRate} from '@/lib/session-projection'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {useNow} from './clock'
import {formatCount, formatDuration, formatTokens, totalTokens} from './format'
import {runPhase, type RunPhase} from './status-meta'

type RunStatusBarProps = {
  /** 这条统计所属的运行 */
  run: RunView | null
  streaming?: StreamingDraft | null
  showCost?: boolean
  sessionCost?: number | null
  onOpenDetails?: (runId: string) => void
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

function RunSummary({elapsed, turns, tokens, cost}: {elapsed: number | null; turns: number; tokens: TokenCounts; cost?: number | null}) {
  const hasSplit = tokens.prompt != null || tokens.completion != null
  const usage = hasSplit ? `输入 ${formatTokens(tokens.prompt)} · 输出 ${formatTokens(tokens.completion)}` : formatTokens(totalTokens(tokens))
  return <section aria-label="运行概览" className="text-meta">
    <h3 className="font-semibold">本次运行</h3>
    <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
      <dt className="text-muted-foreground">用时</dt><dd className="text-right text-xs tabular-nums">{formatDuration(elapsed)}</dd>
      <dt className="text-muted-foreground">模型请求</dt><dd className="text-right text-xs tabular-nums">{turns} 轮</dd>
      <dt className="text-muted-foreground">用量</dt><dd className="text-right text-xs tabular-nums">{usage}</dd>
      {cost !== undefined && <>
        <dt className="text-muted-foreground">估算费用</dt>
        <dd className="text-right text-xs tabular-nums">{cost == null ? '未计价' : formatEstimatedCost(cost)}</dd>
      </>}
    </dl>
  </section>
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

/** 运行概览独立于开发者模式；逐轮数据由对应运行的日志承接。 */
export function RunStatusBar({run, streaming, className, showCost, sessionCost, onOpenDetails}: RunStatusBarProps) {
  const phase = runPhase(run?.status, run?.activity)
  const live = LIVE_PHASES.includes(phase)
  const [open, setOpen] = useState(false)
  const navigating = useRef(false)
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
            <button type="button" aria-label={`${label}。查看运行概览`}
              className="-mr-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-lg px-1 py-1 text-xs tabular-nums text-faint outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground">
              <Stat icon={Clock3} title="本次运行用时" detailsOpen={open}><time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{elapsedText(elapsed)}</time></Stat>
              <Stat icon={Repeat2} title="模型请求轮次" detailsOpen={open}>{turnCount} 轮</Stat>
              <Stat icon={Gauge} title={`输出速度（${speedNote}）`} detailsOpen={open} secondary>{speed} tok/s</Stat>
              {ended && <Stat title={`本次运行已记录 ${total != null ? formatCount(total) : '未知'} Token`} detailsOpen={open} secondary>{formatTokens(total)}</Stat>}
              {costVisible && <Stat icon={Coins} title={costDetail} detailsOpen={open}>{run.costNanos != null ? '≈' + cost : cost}</Stat>}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" sideOffset={8} align="end" collisionPadding={12}
            className="w-64 max-w-[calc(100vw-24px)] px-3.5 py-2.5"
            onCloseAutoFocus={event => {
              if (!navigating.current) return
              navigating.current = false
              event.preventDefault()
            }}>
            <RunSummary elapsed={elapsed} turns={turnCount} tokens={tokens}
              cost={showCost ? run.costNanos ?? (costVisible ? null : undefined) : undefined}/>
            {onOpenDetails && <div className="mt-2 border-t pt-1">
              <Button type="button" variant="ghost" size="xs" className="-mx-1.5 text-signal" onClick={() => {
                navigating.current = true
                setOpen(false)
                onOpenDetails(run.id)
              }}>查看轮次日志 <ArrowRight className="size-3.5" aria-hidden/></Button>
            </div>}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
