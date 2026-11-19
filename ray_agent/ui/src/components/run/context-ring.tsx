import {useState} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import type {UsageView} from '@/lib/session-view'
import {cacheHitRate, formatCount, formatTokens, usageSummary} from './format'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export type ContextLevel = 'none' | 'normal' | 'near' | 'over'
export type ContextUsage = Pick<UsageView, 'context' | 'watermarkRatio'>

export function contextLevel(usage: ContextUsage): ContextLevel {
  const ctx = usage.context
  if (!ctx || ctx.windowTokens <= 0) return 'none'
  if (ctx.fixedInputExceeded) return 'over'
  const ratio = ctx.usedTokens / ctx.windowTokens
  if (ratio > 1) return 'over'
  const near = usage.watermarkRatio != null ? Math.max(0, usage.watermarkRatio - 0.1) : 0.7
  return ratio >= near ? 'near' : 'normal'
}

function contextLabel(ctx: UsageView['context'] | undefined): string {
  if (!ctx || ctx.windowTokens <= 0) return '上下文占用未知'
  const raw = ctx.usedTokens / ctx.windowTokens * 100
  const percent = raw > 0 && raw < 0.5 ? '<1%' : `${Math.round(raw)}%`
  const estimate = ctx.source === 'compact_estimate' || ctx.source === 'request_estimate' || ctx.postCompactEstimate
  return `上下文占用 ${percent}${estimate ? '（估算）' : ctx.configChanged ? '（上次请求）' : ''}`
}

function tokenValue(value: number | null | undefined): string {
  return value == null ? '—' : `${formatCount(value)} Token`
}

function ContextPanel({usage, technical}: {usage: UsageView; technical: boolean}) {
  const ctx = usage.context
  const compacted = ctx?.postCompactEstimate || ctx?.source === 'compact_estimate'
  const last = usage.latestRequest ?? (!compacted ? ctx : null)
  const currentWindow = usage.currentWindowTokens ?? (ctx?.configChanged ? null : ctx?.windowTokens)
  const rows = [
    {label: '最近请求', value: last ? `${formatCount(last.usedTokens)} / ${tokenValue(last.windowTokens)}` : '—'},
    ...(compacted && ctx ? [{label: '压缩后估算', value: tokenValue(ctx.usedTokens)}] : []),
    {label: '当前模型预算', value: tokenValue(currentWindow)},
    {label: '会话累计输入', value: tokenValue(usage.session.prompt)},
    {label: '会话累计输出', value: tokenValue(usage.session.completion)},
  ]
  const cacheRate = cacheHitRate(usage.session)
  return <section role="region" aria-label="上下文详情" className="text-meta">
    <header className="flex items-center gap-2 font-semibold">
      <ContextRingGlyph usage={usage} decorative/>
      <h3>{contextLabel(ctx)}</h3>
    </header>
    {!last && <p className="mt-2 text-xs text-faint">尚无可用的模型请求记录。</p>}
    <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
      {rows.map(({label, value}) => <div key={label} className="contents">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="text-right font-mono text-xs tabular-nums">{value}</dd>
      </div>)}
    </dl>
    {ctx?.fixedInputExceeded && <p className="mt-2 text-xs text-state-failed">固定上下文超过窗口容量。请调大上下文窗口。</p>}
    {technical && <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring">压缩与缓存</summary>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt>压缩阈值</dt><dd>{tokenValue(ctx?.watermarkTokens)}</dd>
        <dt>缓存命中</dt><dd>{formatTokens(usage.session.cached)}</dd>
        <dt>缓存命中率</dt><dd>{cacheRate == null ? '—' : `${Math.round(cacheRate * 100)}%`}</dd>
      </dl>
    </details>}
  </section>
}

export function ContextRing({usage, className, technical = false}: {usage: UsageView; className?: string; technical?: boolean}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const glance = contextLabel(usage.context)
  return <Popover open={open} onOpenChange={value => {setOpen(value); if (value) setHover(false)}}>
    <Tooltip delayDuration={480} open={!open && hover} onOpenChange={setHover}>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" aria-label={glance} aria-description={usageSummary(usage.session)}
            className={cn('inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted [@media(pointer:coarse)]:size-10', className)}>
            <ContextRingGlyph usage={usage} decorative/>
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} tone="contrast">{glance}</TooltipContent>
    </Tooltip>
    <PopoverContent side="bottom" sideOffset={8} align="center" collisionPadding={12}
      className="w-[340px] max-w-[calc(100vw-24px)] rounded-[14px] border-0 bg-background px-3.5 py-3 shadow-(--float-shadow)">
      <ContextPanel usage={usage} technical={technical}/>
    </PopoverContent>
  </Popover>
}

/** 菜单与输入区使用同一条 18px 圆环。 */
export function ContextRingGlyph({usage, className, decorative}: {usage?: ContextUsage; className?: string; decorative?: boolean}) {
  const ctx = usage?.context
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, Math.max(0, ctx.usedTokens / ctx.windowTokens)) : 0
  const estimated = ctx?.source === 'request_estimate' || ctx?.source === 'compact_estimate' || ctx?.postCompactEstimate
  const color = ctx?.fixedInputExceeded ? 'text-state-failed' : estimated ? 'text-muted-foreground' : 'text-signal'
  return <span role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : contextLabel(ctx)}
    className={cn('inline-flex shrink-0', color, className)}>
    <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90" aria-hidden="true">
      <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2.4"/>
      {ratio > 0 && <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
        strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}/>}
    </svg>
  </span>
}
