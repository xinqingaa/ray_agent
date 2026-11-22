import {useState} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import type {UsageView} from '@/lib/session-view'
import {cacheHitRate, formatCount, formatTokens} from './format'

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

function ContextPanel({usage}: {usage: UsageView}) {
  const ctx = usage.context
  const compacted = ctx?.postCompactEstimate || ctx?.source === 'compact_estimate'
  const last = usage.latestRequest ?? (!compacted ? ctx : null)
  const currentWindow = usage.currentWindowTokens ?? (ctx?.configChanged ? null : ctx?.windowTokens)
  const currentEstimate = compacted && ctx ? `${formatCount(ctx.usedTokens)} / ${tokenValue(ctx.windowTokens)}` : null
  const totals = usage.session
  const hasUsage = totals.prompt != null || totals.completion != null || totals.cached != null
  const cacheRate = cacheHitRate(totals)
  return <section role="region" aria-label="上下文详情" className="text-meta">
    <h3 className="font-semibold">{contextLabel(ctx)}</h3>
    {last || currentEstimate || hasUsage ? (
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
        {last && <>
          <dt className="text-muted-foreground">最近请求</dt>
          <dd className="text-right text-xs tabular-nums">{formatCount(last.usedTokens)} / {tokenValue(last.windowTokens)}</dd>
        </>}
        {currentEstimate && <>
          <dt className="text-muted-foreground">压缩后估算</dt>
          <dd className="text-right text-xs tabular-nums">{currentEstimate}</dd>
        </>}
        {ctx?.configChanged && currentWindow != null && currentWindow !== (compacted ? ctx.windowTokens : last?.windowTokens) && <>
          <dt className="text-muted-foreground">当前模型预算</dt>
          <dd className="text-right text-xs tabular-nums">{tokenValue(currentWindow)}</dd>
        </>}
        {ctx?.watermarkTokens != null && <>
          <dt className="text-muted-foreground">压缩阈值{ctx.configChanged && !compacted && <span className="ml-1 text-xs">上次请求</span>}</dt>
          <dd className="text-right text-xs tabular-nums">{tokenValue(ctx.watermarkTokens)}</dd>
        </>}
        {hasUsage && <>
          <dt className="text-muted-foreground">会话累计</dt>
          <dd className="text-right text-xs tabular-nums">输入 {formatTokens(totals.prompt)} · 输出 {formatTokens(totals.completion)}</dd>
          <dt className="text-muted-foreground">缓存命中</dt>
          <dd className="text-right text-xs tabular-nums" title={cacheRate == null ? undefined : '已记录命中 Token 占会话累计输入的比例'}>
            {totals.cached == null ? '未报告' : tokenValue(totals.cached)}
            {cacheRate != null && `（${Math.round(cacheRate * 100)}%）`}
          </dd>
        </>}
      </dl>
    ) : <p className="mt-1 text-xs text-muted-foreground">尚无模型请求记录</p>}
    {ctx?.fixedInputExceeded && <p className="mt-2 text-xs text-state-failed">固定上下文超过窗口容量。请调大上下文窗口。</p>}
  </section>
}

export function ContextRing({usage, className}: {usage: UsageView; className?: string}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const glance = contextLabel(usage.context)
  return <Popover open={open} onOpenChange={value => {setOpen(value); if (value) setHover(false)}}>
    <Tooltip delayDuration={480} open={!open && hover} onOpenChange={setHover}>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" aria-label={glance}
            className={cn('inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted [@media(pointer:coarse)]:size-10', className)}>
            <ContextRingGlyph usage={usage}/>
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} tone="contrast">{glance}</TooltipContent>
    </Tooltip>
    <PopoverContent side="top" sideOffset={8} align="end" collisionPadding={12}
      className="w-[19rem] max-w-[calc(100vw-24px)] px-3.5 py-2.5">
      <ContextPanel usage={usage}/>
    </PopoverContent>
  </Popover>
}

function ContextRingGlyph({usage}: {usage: ContextUsage}) {
  const ctx = usage.context
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, Math.max(0, ctx.usedTokens / ctx.windowTokens)) : 0
  const estimated = ctx?.source === 'request_estimate' || ctx?.source === 'compact_estimate' || ctx?.postCompactEstimate
  const color = ctx?.fixedInputExceeded ? 'text-state-failed' : estimated ? 'text-muted-foreground' : 'text-signal'
  return <svg width="18" height="18" viewBox="0 0 18 18" className={cn('-rotate-90 shrink-0', color)} aria-hidden="true">
      <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2.4"/>
      {ratio > 0 && <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
        strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}/>}
  </svg>
}
