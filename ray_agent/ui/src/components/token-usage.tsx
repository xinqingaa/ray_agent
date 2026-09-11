'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTokenCount } from '@/lib/utils'
import type { UsageEvent } from '@/lib/api/types'

export function occupancyPercent(usage: UsageEvent | null | undefined): number | null {
  if (!usage?.available) return null
  const prompt = usage.prompt_tokens
  const windowSize = usage.context_window
  if (prompt == null || windowSize == null || windowSize <= 0) return null
  return Math.min(100, Math.max(0, (prompt / windowSize) * 100))
}

function remainingTokens(usage: UsageEvent | null | undefined): number | null {
  if (!usage?.available) return null
  const prompt = usage.prompt_tokens
  const windowSize = usage.context_window
  if (prompt == null || windowSize == null || windowSize <= 0) return null
  return Math.max(0, windowSize - prompt)
}

function lastCallTokens(usage: UsageEvent | null | undefined): number | null {
  if (!usage?.available) return null
  if (usage.total_tokens != null) return usage.total_tokens
  const prompt = usage.prompt_tokens
  const completion = usage.completion_tokens
  if (prompt != null && completion != null) return prompt + completion
  return prompt ?? completion ?? null
}

const SIZE = 16
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function TokenUsageRing({ usage }: { usage?: UsageEvent | null }) {
  const percent = occupancyPercent(usage)
  const remaining = remainingTokens(usage)
  const last = lastCallTokens(usage)
  const offset =
    percent == null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - percent / 100)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex size-8 flex-shrink-0 cursor-default items-center justify-center rounded-full"
          aria-label="Token 用量"
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              className="text-gray-200"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              className={
                percent == null
                  ? 'text-gray-200'
                  : percent >= 90
                    ? 'text-red-500'
                    : percent >= 70
                      ? 'text-amber-500'
                      : 'text-gray-500'
              }
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-left">
        {!usage || !usage.available ? (
          <p>暂无用量</p>
        ) : (
          <div className="space-y-0.5">
            <p>已用 {percent == null ? '—' : `${Math.round(percent)}%`}</p>
            <p>剩余 {remaining == null ? '—' : formatTokenCount(remaining)}</p>
            <p>最近一次 {last == null ? '—' : formatTokenCount(last)}</p>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export { TokenUsageRing }
