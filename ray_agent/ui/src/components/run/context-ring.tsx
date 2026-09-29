'use client'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {cn} from '@/lib/utils'
import type {UsageView} from '@/lib/session-view'
import {formatTokens} from './format'

const SIZE = 18
const STROKE = 2.5
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R
/** 未知水位时的“接近”阈值 */
const DEFAULT_NEAR = 0.7
/** 距水位多少比例开始提示 */
const NEAR_MARGIN = 0.1

export type ContextLevel = 'none' | 'normal' | 'near'

export function contextLevel(usage: UsageView): ContextLevel {
  const ctx = usage.context
  if (!ctx || ctx.windowTokens <= 0) return 'none'
  const ratio = ctx.usedTokens / ctx.windowTokens
  const near = usage.watermarkRatio != null ? usage.watermarkRatio - NEAR_MARGIN : DEFAULT_NEAR
  return ratio >= near ? 'near' : 'normal'
}

/** 上下文环：最近一次请求的上下文占用；发生过压缩时带标记。数字在旁边直接可见，细节在悬停提示中 */
export function ContextRing({usage, className}: {usage: UsageView; className?: string}) {
  const ctx = usage.context
  const level = contextLevel(usage)
  const ratio = ctx && ctx.windowTokens > 0 ? Math.min(1, ctx.usedTokens / ctx.windowTokens) : null
  const percent = ratio != null ? Math.round(ratio * 100) : null
  const remaining = ctx ? Math.max(0, ctx.windowTokens - ctx.usedTokens) : null
  const compacted = usage.compactions > 0
  const watermark = usage.watermarkRatio

  const label = !ctx
    ? '上下文占用：暂无数据'
    : `最近一次模型请求的上下文占用 ${percent}%，剩余 ${formatTokens(remaining)} tokens${compacted ? `，已压缩 ${usage.compactions} 次` : ''}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            level === 'near' ? 'text-state-waiting' : 'text-muted-foreground',
            className,
          )}
        >
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
              {watermark != null && ctx && (
                <line
                  x1={SIZE / 2 + (R - STROKE) * Math.cos(2 * Math.PI * watermark)}
                  y1={SIZE / 2 + (R - STROKE) * Math.sin(2 * Math.PI * watermark)}
                  x2={SIZE / 2 + (R + STROKE) * Math.cos(2 * Math.PI * watermark)}
                  y2={SIZE / 2 + (R + STROKE) * Math.sin(2 * Math.PI * watermark)}
                  stroke="currentColor"
                  strokeWidth={1.25}
                  className="text-foreground"
                />
              )}
            </svg>
            {compacted && (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-signal ring-2 ring-card" aria-hidden/>
            )}
          </span>
          <span>{percent != null ? `上下文 ${percent}%` : '上下文 —'}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-left">
        {!ctx ? (
          <p>第一次请求完成后显示</p>
        ) : (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">最近一次请求的占用</p>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
            <dt>已用</dt><dd>{percent}%（{formatTokens(ctx.usedTokens)} / {formatTokens(ctx.windowTokens)}）</dd>
            <dt>剩余</dt><dd>{formatTokens(remaining)}</dd>
            <dt>最近一轮</dt><dd>{formatTokens(ctx.lastTurnTokens)}</dd>
            {watermark != null && (<><dt>压缩水位</dt><dd>{Math.round(watermark * 100)}%</dd></>)}
            <dt>压缩</dt><dd>{compacted ? `已压缩 ${usage.compactions} 次` : '未压缩'}</dd>
            </dl>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
