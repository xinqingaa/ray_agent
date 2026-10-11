'use client'

import {useState} from 'react'
import {cn} from '@/lib/utils'
import type {RunView, StreamingDraft} from '@/lib/session-view'
import {resolveOutputRate, type OutputRate} from '@/lib/session-projection'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {useNow} from './clock'
import {formatCount, totalTokens, usageSummary} from './format'
import {runPhase, type RunPhase} from './status-meta'

type RunStatusBarProps = {
  /** 这条统计所属的运行 */
  run: RunView | null
  streaming?: StreamingDraft | null
  className?: string
}

const LIVE_PHASES: RunPhase[] = ['preparing_environment', 'model', 'tool', 'waiting_reply', 'waiting_approval', 'stopping']

function Field({label, note, children}: {label: string; note: string; children: React.ReactNode}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={label} className="whitespace-nowrap rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  )
}

function elapsedText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`
}

/** 简洁统计独立于开发者模式；本次消耗只在运行进入终态后显示。 */
export function RunStatusBar({run, streaming, className}: RunStatusBarProps) {
  const phase = runPhase(run?.status, run?.activity)
  const live = LIVE_PHASES.includes(phase)
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
    const rate = resolveOutputRate({turnEnded: true, modelMs: turn.modelMs, ttftMs: turn.ttftMs,
      completionTokens: turn.usage?.completion, reasoningTokens: turn.usage?.reasoning})
    if (rate) {recent = {turn: turn.index, rate}; break}
  }
  const rate = currentRate ?? (cached && (!recent || cached.turn > recent.turn) ? cached.rate : recent?.rate ?? cached?.rate)
  const speed = rate ? rate.tokensPerSecond < 1 ? '<1' : String(Math.round(rate.tokensPerSecond)) : '—'
  const speedNote = rate?.estimated ? '按可见文本估算' : rate ? '最近一轮输出速度，不含工具等待' : '尚无速度'
  const tokens = run.summary?.tokens ?? run.tokens
  const total = totalTokens(tokens)

  return (
    <div className={cn('@container/status', className)}>
      <div className="flex min-h-8 items-center justify-end gap-3 py-1">
        {planMode && (
          <span className="shrink-0 rounded-sm bg-signal-soft px-1.5 py-0.5 text-xs font-medium text-signal">
            计划模式
          </span>
        )}
        <div role="group" aria-label="本次运行统计" className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <Field label={`用时 ${elapsedText(elapsed)}`} note="本次运行用时">
            <time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{elapsedText(elapsed)}</time>
          </Field>
          <span aria-hidden>·</span>
          <Field label={`${turnCount} 轮`} note="本次运行的模型轮次">{turnCount}轮</Field>
          <span aria-hidden>·</span>
          <Field label={`${speed} tokens 每秒，${speedNote}`} note={speedNote}>{speed} tok/s</Field>
          {ended && <>
            <span aria-hidden>·</span>
            <Field label={`本次运行已记录 ${total != null ? formatCount(total) : '未知'} tokens`} note={`${usageSummary(tokens)}`}>
              {total != null ? formatCount(total) : '—'} tokens
            </Field>
          </>}
        </div>
      </div>
    </div>
  )
}
