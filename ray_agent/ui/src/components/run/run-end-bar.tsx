'use client'

import {ListChecks, RotateCcw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import type {RunStatus} from '@/lib/session-view'
import {RUN_PHASE, TONE_SOFT, TONE_TEXT} from './status-meta'

type RunEndBarProps = {
  status: Exclude<RunStatus, 'running' | 'waiting' | 'completed'>
  reasonText: string
  /** 失败时“以相同内容重试”要发送的原文；为空则不显示按钮 */
  retryText?: string | null
  onRetry?: (text: string) => void
  retrying?: boolean
  className?: string
}

const NEXT_STEP: Record<RunEndBarProps['status'], string> = {
  failed: '已写入的文件保留在沙箱中。',
  cancelled: '已写入的文件保留在沙箱中，可以继续发送消息开始新的运行。',
  interrupted: '这次运行不会自动恢复，可以重新发送任务。',
}

function nextStep(status: RunEndBarProps['status'], reasonText: string): string {
  if (status === 'failed' && reasonText.includes('准备执行环境')) {
    return '执行环境没有启动。已发送的内容还在，核对镜像和网络后可以重试。'
  }
  return NEXT_STEP[status]
}

/** 终态条：非 completed 的运行结束方式与原因；失败时可以相同内容再发一次 */
export function RunEndBar({status, reasonText, retryText, onRetry, retrying = false, className}: RunEndBarProps) {
  const meta = RUN_PHASE[status]
  const Icon = meta.icon
  return (
    <div
      role="status"
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5', TONE_SOFT[meta.tone], className)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', TONE_TEXT[meta.tone])} aria-hidden/>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={cn('font-medium', TONE_TEXT[meta.tone])}>{meta.label}</span>
          <span className="ml-2">{reasonText}</span>
        </p>
        <p className="text-xs text-muted-foreground">{nextStep(status, reasonText)}</p>
      </div>
      {status === 'failed' && retryText && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-card"
          onClick={() => onRetry?.(retryText)}
          disabled={!onRetry || retrying}
        >
          <RotateCcw aria-hidden/>
          以相同内容重试
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

/** 计划模式运行正常结束后，以普通模式发送固定跟进消息 */
export function PlanExecuteBar({onExecute, disabled = false, className}: PlanExecuteBarProps) {
  return (
    <div
      role="region"
      aria-label="按计划执行"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3.5 py-2.5 bg-state-success-soft', className)}
    >
      <ListChecks className="mt-0.5 size-4 shrink-0 text-state-success" aria-hidden/>
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        计划已写好。确认后将以普通模式执行副作用操作。
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="bg-card"
        onClick={() => onExecute?.()}
        disabled={!onExecute || disabled}
      >
        按计划执行
      </Button>
    </div>
  )
}
