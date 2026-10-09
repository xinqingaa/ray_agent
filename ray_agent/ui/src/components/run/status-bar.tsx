'use client'

import {cn} from '@/lib/utils'
import type {RunView} from '@/lib/session-view'
import {useNow} from './clock'
import {formatClock} from './format'
import {runPhase, type RunPhase} from './status-meta'
import {useDeveloperMode} from '@/hooks/use-developer-mode'

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

/** 进行中只保留用时和轮次。当前一句在时间线末尾，终态原因在终态条。 */
export function RunStatusBar({run, className}: RunStatusBarProps) {
  const {visibility} = useDeveloperMode()
  const phase = runPhase(run?.status, run?.activity)
  const live = LIVE_PHASES.includes(phase)
  const now = useNow(live && run != null)
  if (!run || !live) return null

  const elapsed = now != null ? now - run.startedAt : null
  const turnCount = run.summary?.turns ?? run.turns.length
  const planMode = run.mode === 'plan'

  return (
    <div className={cn('@container/status', className)}>
      <div className="flex min-h-9 items-center gap-3 py-1.5">
        {planMode && (
          <span className="shrink-0 rounded-sm bg-signal-soft px-1.5 py-0.5 text-xs font-medium text-signal">
            计划模式
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Field label="用时">
            <time dateTime={elapsed != null ? `PT${Math.floor(elapsed / 1000)}S` : undefined}>{formatClock(elapsed)}</time>
          </Field>
          {visibility.requestMetrics && turnCount > 0 && <Field label="轮次">{turnCount}</Field>}
        </div>
      </div>
    </div>
  )
}
