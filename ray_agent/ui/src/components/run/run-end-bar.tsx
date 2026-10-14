'use client'

import {ArrowRight, ListChecks, RotateCcw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {cn} from '@/lib/utils'
import type {RunStatus as RunState} from '@/lib/session-view'
import {RunStatus} from './run-status'
import {RUN_PHASE, TONE_SOFT, TONE_TEXT} from './status-meta'

type RunEndBarProps = {
  status: Exclude<RunState, 'running' | 'waiting' | 'completed'>
  reasonText: string
  /** 失败时“以相同内容重试”要发送的原文；为空则不显示按钮 */
  retryText?: string | null
  onRetry?: (text: string) => void
  retrying?: boolean
  className?: string
}

const NEXT_STEP: Record<RunEndBarProps['status'], string> = {
  failed: '已写入的文件保留在沙箱中。',
  cancelled: '可以补充要求，或发送“继续”接着处理。',
  interrupted: '这次运行不会自动恢复，可以重新发送任务。',
}

function nextStep(status: RunEndBarProps['status'], reasonText: string): string {
  if (status === 'failed' && reasonText.includes('准备执行环境')) {
    return '执行环境没有启动。已发送的内容还在，核对镜像和网络后可以重试。'
  }
  return NEXT_STEP[status]
}

/** 失败原因里不再写「可以重试」，重试只由按钮承担。 */
function failureReason(reasonText: string): string {
  return reasonText.replace(/可在本任务中重试。?/g, '').replace(/可直接重试。?/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** 终态条：非 completed 的运行结束方式与原因。失败只留一枚重试，不再配一段重复说明。 */
export function RunEndBar({status, reasonText, retryText, onRetry, retrying = false, className}: RunEndBarProps) {
  const meta = RUN_PHASE[status]
  const Icon = meta.icon
  const showRetry = status === 'failed' && !!retryText && !!onRetry
  const reason = status === 'cancelled' ? '' : status === 'failed' ? failureReason(reasonText) : reasonText
  return (
    <div
      role="status"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5', TONE_SOFT[meta.tone], className)}
    >
      <Icon className={cn('size-4 shrink-0', TONE_TEXT[meta.tone])} aria-hidden/>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={cn('font-medium', TONE_TEXT[meta.tone])}><RunStatus place="terminal" status={status}/></span>
          {reason ? <span className="ml-2">{reason}</span> : null}
        </p>
        {status !== 'failed' && <p className="text-xs text-muted-foreground">{nextStep(status, reasonText)}</p>}
      </div>
      {showRetry && (
        <Button
          type="button"
          size="icon-sm"
          aria-label="重试"
          variant="outline"
          className="bg-transparent"
          onClick={() => onRetry?.(retryText)}
          disabled={retrying}
        >
          <RotateCcw aria-hidden/>
        </Button>
      )}
    </div>
  )
}


type PlanExecuteBarProps = {
  onExecute?: () => void
  disabled?: boolean
  className?: string
}

export function PlanExecuteBar({onExecute, disabled = false, className}: PlanExecuteBarProps) {
  return (
    <div role="region" aria-label="按计划执行" className={cn('flex items-center gap-3 rounded-lg bg-state-success-soft px-3.5 py-2.5', className)}>
      <ListChecks className="size-4 shrink-0 text-state-success" aria-hidden/>
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">计划已写好，点击右侧按钮开始执行。</p>
      <IconAction label="按计划执行" variant="ghost" className="shrink-0 text-state-success hover:bg-state-success/10 hover:text-state-success" onClick={() => onExecute?.()} disabled={!onExecute || disabled}>
        <ArrowRight className="size-4" aria-hidden/>
      </IconAction>
    </div>
  )
}
