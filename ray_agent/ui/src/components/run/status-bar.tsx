'use client'

import {Loader2, Square} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import type {RunView} from '@/lib/session-view'
import {useNow} from './clock'
import {formatClock, formatDuration, formatTokens, totalTokens} from './format'
import {RUN_PHASE, runPhase, TONE_SOFT, TONE_TEXT, type RunPhase} from './status-meta'

export type OutputRate = {tokensPerSecond: number; estimated: boolean}

type RunStatusBarProps = {
  /** 最新一次运行；没有运行时为空（空闲） */
  run: RunView | null
  onStop?: () => void
  /** W6 接入：生成速度 */
  outputRate?: OutputRate | null
  className?: string
}

const LIVE_PHASES: RunPhase[] = ['model', 'tool', 'waiting_reply', 'waiting_approval', 'stopping']

function Field({label, children, className}: {label: string; children: React.ReactNode; className?: string}) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-meta font-medium tabular-nums text-foreground">{children}</span>
    </span>
  )
}

function activityText(run: RunView | null, phase: RunPhase, now: number | null): string {
  if (!run) return '发送消息后开始运行'
  const a = run.activity
  switch (phase) {
    case 'model': {
      const since = a.kind === 'model' && now != null ? now - a.startedAt : null
      return since != null && since >= 1000 ? `正在思考下一步，本轮已 ${formatDuration(since)}` : '正在思考下一步'
    }
    case 'tool': {
      if (a.kind !== 'tool') return '正在执行工具'
      const since = now != null ? now - a.startedAt : null
      return since != null && since >= 1000 ? `${a.title}，已 ${formatDuration(since)}` : a.title
    }
    case 'waiting_reply':
      return a.kind === 'waiting_reply' ? `提问：${a.question}` : '等待你回复提问'
    case 'waiting_approval':
      return a.kind === 'waiting_approval' ? `需要你批准：${a.title}` : '等待你批准一个操作'
    case 'stopping':
      return '正在停止，等待当前操作结束'
    case 'completed':
      return run.summary ? `完成 ${run.summary.toolCalls} 次工具调用` : '运行正常结束'
    case 'failed':
      return run.reasonText ?? '运行失败，原因未记录'
    case 'cancelled':
      return run.reasonText ?? '你停止了这次运行'
    case 'interrupted':
      return run.reasonText ?? '服务重启导致运行中断'
    default:
      return ''
  }
}

/**
 * 运行状态条：状态、已用时间、轮次、当前动作、本次运行 tokens 与停止按钮。
 * 同屏唯一的持续动画是运行中当前动作文字的扫光。
 */
export function RunStatusBar({run, onStop, outputRate, className}: RunStatusBarProps) {
  const phase = runPhase(run?.status, run?.activity)
  const meta = RUN_PHASE[phase]
  const live = LIVE_PHASES.includes(phase)
  const now = useNow(live && run != null)
  const Icon = meta.icon

  const elapsed = !run
    ? null
    : run.endedAt != null
      ? run.summary?.durationMs ?? run.endedAt - run.startedAt
      : now != null
        ? now - run.startedAt
        : null
  const turnCount = run ? run.summary?.turns ?? run.turns.length : 0
  const tokens = run ? totalTokens(run.summary?.tokens ?? run.tokens) : null
  const text = activityText(run, phase, now)
  const animate = phase === 'model' || phase === 'tool'
  const showStop = run != null && (run.status === 'running' || run.status === 'waiting')
  const isFailure = phase === 'failed' || phase === 'interrupted'

  return (
    <div className={cn('@container/status border-b bg-card', className)}>
      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
        <span
          role="status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium whitespace-nowrap',
            TONE_SOFT[meta.tone],
            TONE_TEXT[meta.tone],
          )}
        >
          <Icon className="size-3.5" aria-hidden/>
          {meta.label}
        </span>

        {run && (
          <Field label="用时">
            <time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{formatClock(elapsed)}</time>
          </Field>
        )}
        {run && (
          <Field label="轮次" className="hidden @sm/status:inline-flex">
            {turnCount}
            {run.maxTurns != null && <span className="text-muted-foreground font-normal">/{run.maxTurns}</span>}
          </Field>
        )}

        <p
          className={cn(
            'order-last basis-full min-w-0 truncate text-meta @lg/status:order-none @lg/status:basis-0 @lg/status:flex-1',
            isFailure ? TONE_TEXT[meta.tone] : 'text-muted-foreground',
            animate && 'text-foreground',
          )}
          title={text}
        >
          <span className={cn(animate && 'text-shimmer')}>{text}</span>
        </p>

        <div className="ml-auto flex items-center gap-4">
          {outputRate && (
            <Field label={outputRate.estimated ? '速度（估算）' : '速度'} className="hidden @2xl/status:inline-flex">
              {Math.round(outputRate.tokensPerSecond)} tok/s
            </Field>
          )}
          {run && <Field label="tokens" className="hidden @xs/status:inline-flex">{formatTokens(tokens)}</Field>}
          {showStop && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={phase === 'stopping' || !onStop}
              className="h-7 gap-1.5 px-2.5 hover:border-state-failed/50 hover:text-state-failed"
            >
              {phase === 'stopping' ? <Loader2 className="size-3.5 animate-spin" aria-hidden/> : <Square className="size-3 fill-current" aria-hidden/>}
              {phase === 'stopping' ? '停止中' : '停止'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
