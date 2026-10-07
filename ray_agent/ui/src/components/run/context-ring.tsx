'use client'

import {useState} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import type {TokenCounts, UsageView} from '@/lib/session-view'
import {cacheHitRate, formatTokens, hasTokenUsage, usageSummary} from './format'

const SIZE = 18
const STROKE = 2.5
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

export type ContextLevel = 'none' | 'normal' | 'near' | 'over'

export function contextLevel(usage: UsageView): ContextLevel {
  const ctx = usage.context
  if (!ctx || ctx.windowTokens <= 0) return 'none'
  if (ctx.fixedInputExceeded) return 'over'
  const ratio = ctx.usedTokens / ctx.windowTokens
  if (ratio > 1) return 'over'
  const near = usage.watermarkRatio != null ? Math.max(0, usage.watermarkRatio - 0.1) : 0.7
  return ratio >= near ? 'near' : 'normal'
}

function occupancyValue(ctx: NonNullable<UsageView['context']>): string {
  const raw = ctx.usedTokens / ctx.windowTokens * 100
  const percent = ctx.usedTokens > 0 && raw < 0.5 ? '<1%' : `${Math.round(raw)}%`
  return `${percent} · ${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)}`
}

function occupancyLine(ctx: NonNullable<UsageView['context']>): string {
  return `已用 ${occupancyValue(ctx)}`
}

function thresholdText(usage: UsageView): string {
  const ctx = usage.context
  if (!ctx || ctx.windowTokens <= 0) return '—'
  const tokens = ctx.watermarkTokens ?? (usage.watermarkRatio != null ? Math.round(usage.watermarkRatio * ctx.windowTokens) : null)
  if (tokens == null) return '—'
  const percent = Math.round(tokens / ctx.windowTokens * 100)
  return `${formatTokens(tokens)}（${percent}%）`
}

function usageRows(tokens: TokenCounts): {label: string; value: string}[] {
  const rate = cacheHitRate(tokens)
  return [
    {label: '累计输入', value: formatTokens(tokens.prompt)},
    {label: '累计输出', value: formatTokens(tokens.completion)},
    {label: '缓存命中', value: tokens.cached == null ? '—' : formatTokens(tokens.cached)},
    {label: '命中率', value: rate == null ? '—' : `${Math.round(rate * 100)}%`},
  ]
}

function MetricRows({rows}: {rows: {label: string; value: string}[]}) {
  return rows.map((row) => (
    <div key={row.label} className="contents">
      <dt className="text-muted-foreground">{row.label}</dt>
      <dd className="text-right text-foreground">{row.value}</dd>
    </div>
  ))
}

function ContextPanel({usage}: {usage: UsageView}) {
  const ctx = usage.context
  const ready = ctx != null && ctx.windowTokens > 0
  const occupancy = ready && ctx ? [
    {label: '已用', value: occupancyValue(ctx)},
    {label: '最近一轮', value: formatTokens(ctx.lastTurnTokens)},
    {label: '压缩阈值', value: thresholdText(usage)},
  ] : []
  const totals = hasTokenUsage(usage.session) ? usageRows(usage.session) : []
  return (
    <div className="space-y-2">
      <p className="text-meta font-medium">最近请求 / 压缩快照</p>
      {ctx?.configChanged && <p className="text-xs text-state-waiting">这是上次运行的快照。</p>}
      {occupancy.length === 0 && <p className="text-meta text-muted-foreground">暂无占用</p>}
      {(occupancy.length > 0 || totals.length > 0) && (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5 text-meta tabular-nums">
          <MetricRows rows={occupancy}/>
          {occupancy.length > 0 && totals.length > 0 && <div className="col-span-2 border-t"/>}
          <MetricRows rows={totals}/>
        </dl>
      )}
      {ctx?.fixedInputExceeded && (
        <p className="text-meta text-state-failed">项目说明或笔记超过容量，压缩历史无法解决。请精简项目设置或调大上下文窗口。</p>
      )}
    </div>
  )
}

/** 纯圆环。悬停一行占用；点击再看最近一轮、压缩阈值和本会话用量。 */
export function ContextRing({usage, className}: {usage: UsageView; className?: string}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const ctx = usage.context
  const level = contextLevel(usage)
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, Math.max(0, ctx.usedTokens / ctx.windowTokens)) : null
  const watermark = usage.watermarkRatio
  const tick = ctx && watermark != null && watermark > 0 && watermark < 1
    ? 2 * Math.PI * watermark : null
  const glance = ctx && ctx.windowTokens > 0 ? occupancyLine(ctx) : '暂无占用'
  const label = hasTokenUsage(usage.session) ? `${glance}，${usageSummary(usage.session)}` : glance
  return (
    <Popover open={open} onOpenChange={(value) => {setOpen(value); if (value) setHover(false)}}>
      <Tooltip open={!open && hover} onOpenChange={setHover}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:size-11',
                level === 'over' ? 'text-state-failed' : level === 'near' ? 'text-state-waiting' : 'text-muted-foreground',
                className,
              )}
            >
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeDasharray={ctx ? undefined : '2 2.4'} className="opacity-25"/>
                {ratio != null && ratio > 0 && (
                  <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)}/>
                )}
                {tick != null && (
                  <line
                    x1={SIZE / 2 + 3.4 * Math.cos(tick)}
                    y1={SIZE / 2 + 3.4 * Math.sin(tick)}
                    x2={SIZE / 2 + (R - STROKE / 2 + 0.6) * Math.cos(tick)}
                    y2={SIZE / 2 + (R - STROKE / 2 + 0.6) * Math.sin(tick)}
                    stroke="currentColor"
                    strokeWidth={1.75}
                    className="text-foreground"
                  />
                )}
              </svg>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-left">{glance}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <ContextPanel usage={usage}/>
      </PopoverContent>
    </Popover>
  )
}
