'use client'

import {useState} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import type {UsageView} from '@/lib/session-view'
import {commandById, type CommandContext} from '@/lib/commands'
import {formatTokens} from './format'

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
function sourceText(ctx: NonNullable<UsageView['context']>): string {
  const base = ctx.source === 'prompt_usage' ? '最近请求实测输入'
    : ctx.source === 'compact_estimate' || ctx.postCompactEstimate ? '压缩后估算'
      : '请求前估算（请求中或未返回 usage）'
  return ctx.includesProjectContext ? `${base} · 按当前项目内容估算` : base
}
function ContextData({usage}: {usage: UsageView}) {
  const ctx = usage.context
  if (!ctx) return <p className="text-meta text-muted-foreground">暂无可比占用数据；等待请求或完整摘要快照。</p>
  const percent = Math.round(ctx.usedTokens / ctx.windowTokens * 100)
  return <>
    <p className="mb-2 text-xs text-muted-foreground">{sourceText(ctx)}{ctx.configChanged ? ' · 旧配置快照' : ''}</p>
    {ctx.fixedInputExceeded && <p className="mb-2 text-xs text-state-failed">项目说明/笔记等固定输入超过容量，压缩历史无法解决。请精简项目设置或调整模型窗口。</p>}
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta tabular-nums">
      <dt className="text-muted-foreground">占用</dt><dd>{percent}%</dd>
      <dt className="text-muted-foreground">已用 / 窗口</dt><dd>{formatTokens(ctx.usedTokens)} / {formatTokens(ctx.windowTokens)}</dd>
      <dt className="text-muted-foreground">窗口剩余</dt><dd>{formatTokens(Math.max(0, ctx.windowTokens - ctx.usedTokens))}</dd>
      <dt className="text-muted-foreground">可用输入余量</dt><dd>{formatTokens(ctx.inputRemaining ?? null)}</dd>
      <dt className="text-muted-foreground">最近一轮</dt><dd>{formatTokens(ctx.lastTurnTokens)}</dd>
      <dt className="text-muted-foreground">自动检查水位</dt><dd>{ctx.watermarkTokens != null ? `${formatTokens(ctx.watermarkTokens)}（${Math.round(ctx.watermarkTokens / ctx.windowTokens * 100)}%）` : '暂无数据'}</dd>
    </dl>
  </>
}

/** 纯圆环入口；悬停/聚焦与点击消费同一快照。 */
export function ContextRing({usage, commandContext, className}: {usage: UsageView; commandContext?: CommandContext; className?: string}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const ctx = usage.context
  const level = contextLevel(usage)
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, Math.max(0, ctx.usedTokens / ctx.windowTokens)) : null
  const watermark = usage.watermarkRatio
  const tick = ctx && watermark != null && watermark > 0 && watermark < 1
    ? 2 * Math.PI * watermark : null
  const compact = commandById('compact')
  const available = ctx?.fixedInputExceeded ? {available: false as const, reason: '固定输入超过容量，压缩历史无法解决'} : compact && commandContext ? compact.available(commandContext) : {available: false as const, reason: '还没有可压缩的上下文'}
  const label = ctx
    ? `上下文占用 ${Math.round(ctx.usedTokens / ctx.windowTokens * 100)}%，${sourceText(ctx)}${ctx.configChanged ? '，旧配置快照' : ''}，已用 ${ctx.usedTokens}，窗口 ${ctx.windowTokens}，${available.available ? '可以手动压缩' : available.reason}`
    : '上下文占用暂无可比数据'
  return <Popover open={open} onOpenChange={(value) => {setOpen(value); if (value) setHover(false)}}>
    <Tooltip open={!open && hover} onOpenChange={setHover}>
      <TooltipTrigger asChild><PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn('inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:size-11', level === 'over' ? 'text-state-failed' : level === 'near' ? 'text-state-waiting' : 'text-muted-foreground', className)}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
            <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeDasharray={ctx ? undefined : '2 2.4'} className="opacity-25"/>
            {ratio != null && ratio > 0 && <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)}/>}
            {tick != null && <line x1={SIZE/2 + 3.4*Math.cos(tick)} y1={SIZE/2 + 3.4*Math.sin(tick)} x2={SIZE/2 + (R-STROKE/2+0.6)*Math.cos(tick)} y2={SIZE/2 + (R-STROKE/2+0.6)*Math.sin(tick)} stroke="currentColor" strokeWidth={1.75} className="text-foreground"/>}
          </svg>
        </button>
      </PopoverTrigger></TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 text-left"><ContextData usage={usage}/></TooltipContent>
    </Tooltip>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
      <ContextData usage={usage}/>
      <p className="mt-2 text-xs text-muted-foreground">下次请求前按估算检查，可能自动压缩；实测输入超过刻度不代表必然触发。</p>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">预算与压缩历史</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
          <dt>可用输入上限</dt><dd>{formatTokens(ctx?.inputLimit ?? null)}</dd>
          <dt>输出预留</dt><dd>{formatTokens(ctx?.maxTokens ?? null)}</dd>
          <dt>安全余量</dt><dd>{formatTokens(ctx?.safetyTokens ?? null)}</dd>
          <dt>快照时间</dt><dd>{ctx?.snapshotAt != null ? new Date(ctx.snapshotAt).toLocaleString() : '暂无数据'}</dd>
          <dt>压缩次数</dt><dd>{usage.compactions}</dd>
          <dt>最近压缩估算</dt><dd>{usage.lastCompaction ? `${formatTokens(usage.lastCompaction.beforeTotal)} → ${formatTokens(usage.lastCompaction.afterTotal)}` : '未压缩'}</dd>
        </dl>
        <p className="mt-2">窗口和预算为该请求或摘要时的配置快照，修改配置后由下次请求更新。</p>
      </details>
      <div className="mt-3 border-t pt-2">
        <Button type="button" size="sm" variant="outline" className="w-full" disabled={!available.available} onClick={() => {
          if (compact && commandContext && available.available) {compact.run(commandContext); setOpen(false)}
        }}>压缩上下文</Button>
        {!available.available && <p className="mt-1 text-xs text-muted-foreground">{available.reason}</p>}
      </div>
    </PopoverContent>
  </Popover>
}
