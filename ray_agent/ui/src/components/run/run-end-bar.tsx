import type {ReactNode} from 'react'
import {RotateCcw} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
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
  onContinue?: () => void
  continuing?: boolean
  hasUnconsumedInput?: boolean
  planConsumed?: boolean
  planAction?: ReactNode
  priorTools?: boolean
  className?: string
}

const NEXT_STEP: Record<RunEndBarProps['status'], string> = {
  failed: '已写入的文件与成果仍保留在当前会话中。',
  cancelled: '可以补充要求，或点击“继续任务”接着处理。',
  interrupted: '这次运行已中断，可以点击“继续任务”接着处理。',
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
export function RunEndBar({
  status,
  reasonText,
  retryText,
  onRetry,
  retrying = false,
  onContinue,
  continuing = false,
  hasUnconsumedInput = false,
  planConsumed = false,
  planAction,
  priorTools = false,
  className,
}: RunEndBarProps) {
  const meta = RUN_PHASE[status]
  const Icon = meta.icon
  const showContinue = !!onContinue
  const showRetry = !planConsumed && !hasUnconsumedInput && status === 'failed' && !!retryText && !!onRetry
  const hasActions = (planConsumed && !!planAction) || showContinue || showRetry
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
        {planConsumed && <p className="text-xs text-muted-foreground">计划已受理。可先查看计划清单与已完成步骤，或直接点击“继续任务”接着执行。</p>}
        {hasUnconsumedInput && <p className="text-xs text-muted-foreground">上一条消息尚未开始处理，点击“继续任务”将直接续接该消息。</p>}
        {showRetry && priorTools && <p className="text-xs text-muted-foreground">本次运行已有工具操作，重试前请核对已完成的步骤。</p>}
        {status !== 'failed' && !hasUnconsumedInput && <p className="text-xs text-muted-foreground">{nextStep(status, reasonText)}</p>}
      </div>
      {hasActions && (
        <div className="flex shrink-0 items-center gap-1.5">
          {planConsumed && planAction}
          {showContinue && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 bg-transparent px-2.5"
              onClick={onContinue}
              disabled={continuing || retrying}
            >
              继续任务
            </Button>
          )}
          {showRetry && (
            <Button
              type="button"
              size="icon-sm"
              aria-label="重试"
              variant="outline"
              className="bg-transparent"
              onClick={() => onRetry?.(retryText)}
              disabled={retrying || continuing}
            >
              <RotateCcw aria-hidden/>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
