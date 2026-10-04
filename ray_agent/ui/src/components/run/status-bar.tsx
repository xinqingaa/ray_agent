'use client'

import {Loader2} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {RunView} from '@/lib/session-view'
import {useNow} from './clock'
import {formatClock, formatDuration} from './format'
import {RUN_PHASE, runPhase, TONE_TEXT, type RunPhase} from './status-meta'

type RunStatusBarProps = {
  /** 最新一次运行；没有运行时为空（空闲） */
  run: RunView | null
  className?: string
}

const LIVE_PHASES: RunPhase[] = ['preparing_environment', 'model', 'tool', 'waiting_reply', 'waiting_approval', 'stopping']

function Field({label, children, className}: {label: string; children: React.ReactNode; className?: string}) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 whitespace-nowrap', className)}>
      <span className="text-xs leading-5 text-muted-foreground">{label}</span>
      <span className="text-meta font-medium leading-5 tabular-nums text-foreground">{children}</span>
    </span>
  )
}

function activityText(run: RunView | null, phase: RunPhase, now: number | null): string {
  if (!run) return '发送消息后开始运行'
  const a = run.activity
  switch (phase) {
    case 'preparing_environment':
      return '正在启动沙箱'
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

/** 手动压缩不改变运行状态，单独占状态行，避免页头仍显示已完成。 */
export function CompactingStatusBar({className}: {className?: string}) {
  return (
    <div className={cn('@container/status', className)}>
      <div className="flex min-h-9 items-center gap-3 py-1.5">
        <span role="status" className="shrink-0 text-xs font-medium whitespace-nowrap text-state-running">压缩中</span>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">正在摘要较早的对话</p>
      </div>
    </div>
  )
}

/** 只在运行、等待或异常结束时显示的轻量状态行；完成汇总留给时间线。暂停在输入框的发送位。 */
export function RunStatusBar({run, className}: RunStatusBarProps) {
  const phase = runPhase(run?.status, run?.activity)
  const meta = RUN_PHASE[phase]
  const live = LIVE_PHASES.includes(phase)
  const now = useNow(live && run != null)

  const elapsed = !run
    ? null
    : run.endedAt != null
      ? run.summary?.durationMs ?? run.endedAt - run.startedAt
      : now != null
        ? now - run.startedAt
        : null
  const turnCount = run ? run.summary?.turns ?? run.turns.length : 0
  const text = activityText(run, phase, now)
  const isFailure = phase === 'failed' || phase === 'interrupted'
  const planMode = run?.mode === 'plan' && live
  if (!run || phase === 'completed' || phase === 'cancelled') return null

  return (
    <div className={cn('@container/status', className)}>
      <div className="flex min-h-9 items-center gap-3 py-1.5">
        {planMode && (
          <span className="shrink-0 rounded-sm bg-signal-soft px-1.5 py-0.5 text-xs font-medium text-signal">
            计划模式
          </span>
        )}
        <span
          role="status"
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap',
            isFailure || phase === 'waiting_reply' || phase === 'waiting_approval'
              ? TONE_TEXT[meta.tone] : 'text-muted-foreground',
          )}
        >
          {(phase === 'preparing_environment' || phase === 'model' || phase === 'tool') && (
            <Loader2 className="size-3.5 animate-spin text-state-running" aria-hidden/>
          )}
          {meta.label}
        </span>
        <p
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={text}
        >
          {text}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {!isFailure && <Field label="用时" className="hidden @xs/status:inline-flex">
            <time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{formatClock(elapsed)}</time>
          </Field>}
          {!isFailure && turnCount > 0 && <Field label="轮次" className="hidden @lg/status:inline-flex">{turnCount}</Field>}
        </div>
      </div>
    </div>
  )
}
