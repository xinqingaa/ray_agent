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
/** 未知水位时的“接近”阈值 */
const DEFAULT_NEAR = 0.7
/** 距水位多少比例开始提示 */
const NEAR_MARGIN = 0.1
/**
 * 刻度停在环带内侧。描边外沿是 R + STROKE/2 = 9，正好贴着画布半径；
 * 再向外画会被裁成毛刺。外端只咬进描边一截，内端留在环心。
 */
const TICK_OUTER = R - STROKE / 2 + 0.6
const TICK_INNER = 3.4
const TICK_WIDTH = 1.75

const TRIGGER_LABEL: Record<'watermark' | 'overflow' | 'manual', string> = {
  manual: '你手动压缩',
  watermark: '接近上限后自动压缩',
  overflow: '超出窗口后压缩重试',
}

export type ContextLevel = 'none' | 'normal' | 'near'

export function contextLevel(usage: UsageView): ContextLevel {
  const ctx = usage.context
  if (!ctx || ctx.windowTokens <= 0) return 'none'
  const ratio = ctx.usedTokens / ctx.windowTokens
  const near = usage.watermarkRatio != null ? usage.watermarkRatio - NEAR_MARGIN : DEFAULT_NEAR
  return ratio >= near ? 'near' : 'normal'
}

function tickEnds(ratio: number) {
  const angle = 2 * Math.PI * ratio
  const at = (radius: number) => ({
    x: SIZE / 2 + radius * Math.cos(angle),
    y: SIZE / 2 + radius * Math.sin(angle),
  })
  return {inner: at(TICK_INNER), outer: at(TICK_OUTER)}
}

function ringSvg(ctx: UsageView['context'], ratio: number | null, watermark: number | null | undefined, compacted: boolean) {
  const tick = watermark != null && ctx ? tickEnds(watermark) : null
  return (
    <span className="relative inline-flex">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray={ctx ? undefined : '2 2.4'}
          className="opacity-25"
        />
        {ratio != null && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - Math.max(ratio, 0.02))}
          />
        )}
        {tick && (
          <line
            x1={tick.inner.x}
            y1={tick.inner.y}
            x2={tick.outer.x}
            y2={tick.outer.y}
            stroke="currentColor"
            strokeWidth={TICK_WIDTH}
            strokeLinecap="butt"
            className="text-foreground"
          />
        )}
      </svg>
      {compacted && (
        <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-signal ring-2 ring-card" aria-hidden/>
      )}
    </span>
  )
}

/** 上下文环：最近一次请求的上下文占用；点击打开详情，悬停仍为简短说明 */
export function ContextRing({
  usage,
  commandContext,
  className,
}: {
  usage: UsageView
  commandContext?: CommandContext
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ctx = usage.context
  const level = contextLevel(usage)
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, ctx.usedTokens / ctx.windowTokens) : null
  const percent = ratio != null ? Math.round(ratio * 100) : null
  const remaining = ctx ? Math.max(0, ctx.windowTokens - ctx.usedTokens) : null
  const compacted = usage.compactions > 0
  const watermark = usage.watermarkRatio
  const last = usage.lastCompaction

  const label = !ctx
    ? '上下文占用：暂无数据'
    : `最近一次模型请求的上下文占用 ${percent}%，剩余 ${formatTokens(remaining)} tokens${compacted ? `，已压缩 ${usage.compactions} 次` : ''}`

  const compactCommand = commandById('compact')
  const compactAvailability = compactCommand && commandContext
    ? compactCommand.available(commandContext)
    : {available: false as const, reason: '还没有可压缩的上下文'}

  const runCompact = () => {
    if (!compactCommand || !commandContext || !compactAvailability.available) return
    compactCommand.run(commandContext)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                level === 'near' ? 'text-state-waiting' : 'text-muted-foreground',
                className,
              )}
            >
              {ringSvg(ctx, ratio, watermark, compacted)}
              <span>{percent != null ? `上下文 ${percent}%` : '上下文 —'}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-80 text-left text-wrap">
          {!ctx ? (
            <p>第一次请求完成后显示</p>
          ) : (
            <div className="space-y-1">
              <p className="whitespace-nowrap">到达刻度后，下一次模型请求前会自动压缩</p>
              <p>
                {watermark != null
                  ? '变黄表示最近一次请求的占用达到刻度前 10 个百分点。'
                  : '当前没有刻度。变黄表示最近一次请求的占用达到 70%。'}
                右上圆点表示本会话已经压缩过。环上的百分比是最近一次模型请求的占用，不是用来判断压缩的估算。
              </p>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-80 text-sm">
        {!ctx ? (
          <p className="text-meta text-muted-foreground">第一次模型请求完成后显示占用与压缩信息。</p>
        ) : (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta tabular-nums">
              <dt className="text-muted-foreground">已用</dt>
              <dd>
                {percent}%（{formatTokens(ctx.usedTokens)} / {formatTokens(ctx.windowTokens)}）
                {ctx.postCompactEstimate && (
                  <span className="mt-0.5 block text-xs text-state-waiting">压缩后估算，下一次请求后更新</span>
                )}
              </dd>
              <dt className="text-muted-foreground">剩余</dt>
              <dd>{formatTokens(remaining)}</dd>
              <dt className="text-muted-foreground">最近一轮</dt>
              <dd>{formatTokens(ctx.lastTurnTokens)}</dd>
              {watermark != null && (
                <>
                  <dt className="text-muted-foreground">压缩水位</dt>
                  <dd>{Math.round(watermark * 100)}%</dd>
                </>
              )}
              <dt className="text-muted-foreground">已压缩</dt>
              <dd>{compacted ? `${usage.compactions} 次` : '未压缩'}</dd>
              {last && (
                <>
                  <dt className="text-muted-foreground">最近触发</dt>
                  <dd>{TRIGGER_LABEL[last.trigger]}</dd>
                </>
              )}
            </dl>
            {compactCommand && commandContext && (
              <div className="space-y-1 border-t pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={!compactAvailability.available}
                  onClick={runCompact}
                >
                  立即压缩
                </Button>
                {!compactAvailability.available && (
                  <p className="text-xs text-muted-foreground">{compactAvailability.reason}</p>
                )}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
