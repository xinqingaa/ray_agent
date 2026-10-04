'use client'

import {useLayoutEffect, useRef, type ReactNode} from 'react'
import {Loader2} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {ProjectFileOperation, SessionStatus} from '@/lib/api/types'
import type {Activity, RunStatus as RunState} from '@/lib/session-view'
import type {WaitKind} from '@/providers/sessions-provider'
import {TONE_TEXT} from './status-meta'

/**
 * 用户看见的运行状态只在这里维护。
 * 调用方传入原始信号，组件自己决定词和怎么画。输入框提示见同文件的 RUN_INPUT_HINT。
 */
const TEXT = {
  thinking: '正在思考',
  preparing: '正在准备执行环境',
  stopping: '正在停止',
  compacting: '正在压缩上下文',
  compactingShort: '压缩中',
  pending: '准备中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
  waitReply: '等你回复',
  waitApproval: '等你批准',
  waitUnknown: '等你',
  replied: '已回复',
  approvalRecord: '审批记录',
  unavailable: '不可用',
  needsRepair: '需修复',
  filesBusy: '文件处理中',
  archived: '已归档',
} as const

const SIDEBAR_META = 'w-[4.75rem] shrink-0 truncate pr-2 text-right text-xs font-normal tabular-nums group-hover/session:invisible group-has-[[data-state=open]]/session:invisible'

type TimelineProps = {
  place: 'timeline'
  compacting: boolean
  pendingSend: boolean
  activity?: Activity['kind'] | null
  streaming: boolean
  running: boolean
  tailQuiet: boolean
  className?: string
}

type SidebarProps = {
  place: 'sidebar'
  id: string
  /** 无障碍名称的前半段，和状态词合成「标题，状态」 */
  title: string
  status: SessionStatus
  waitKind: WaitKind | null
  compacting: boolean
  time: string
  showTime: boolean
}

type HeadlineProps = {
  place: 'headline'
  status?: RunState | null
  compacting: boolean
  className?: string
}

type AskProps = {place: 'ask'; answered: boolean}
type ApprovalProps = {place: 'approval'; pending: boolean}
type TerminalProps = {place: 'terminal'; status: Exclude<RunState, 'running' | 'waiting' | 'completed'>}

type ProjectProps = {
  place: 'project'
  name: string
  available: boolean
  reason?: string | null
  activeRunStatus?: string | null
  activeRunReason?: string | null
  fileOperation?: Pick<ProjectFileOperation, 'state' | 'error'> | null
  archived?: boolean
}

type RunStatusProps =
  | TimelineProps
  | SidebarProps
  | HeadlineProps
  | AskProps
  | ApprovalProps
  | TerminalProps
  | ProjectProps

function timelineSentence(input: TimelineProps): string | null {
  const activity = input.activity
  if (activity === 'tool') return null
  const specific = activity === 'preparing_environment'
    ? TEXT.preparing
    : activity === 'stopping'
      ? TEXT.stopping
      : null
  if (input.compacting && !input.pendingSend) return TEXT.compacting
  if (input.pendingSend) {
    if (specific) return specific
    if (activity === 'waiting_reply' || activity === 'waiting_approval' || input.streaming) return null
    return TEXT.thinking
  }
  if (specific) return specific
  if (activity === 'waiting_reply' || activity === 'waiting_approval') return null
  if (!input.streaming && input.tailQuiet && input.running && (activity === 'model' || activity === 'idle' || activity == null)) {
    return TEXT.thinking
  }
  return null
}

function sidebarWord(status: SessionStatus, waitKind: WaitKind | null, compacting: boolean): {label: string; attention: boolean; tone: string | null} {
  if (compacting) return {label: TEXT.compactingShort, attention: true, tone: TONE_TEXT.running}
  switch (status) {
    case 'pending': return {label: TEXT.pending, attention: true, tone: TONE_TEXT.running}
    case 'running': return {label: TEXT.running, attention: true, tone: TONE_TEXT.running}
    case 'waiting':
      return {
        label: waitKind === 'approval' ? TEXT.waitApproval : waitKind === 'reply' ? TEXT.waitReply : TEXT.waitUnknown,
        attention: true,
        tone: TONE_TEXT.waiting,
      }
    case 'failed': return {label: TEXT.failed, attention: true, tone: TONE_TEXT.failed}
    case 'interrupted': return {label: TEXT.interrupted, attention: true, tone: TONE_TEXT.interrupted}
    case 'completed': return {label: TEXT.completed, attention: false, tone: null}
    case 'cancelled': return {label: TEXT.cancelled, attention: false, tone: null}
  }
}

function projectMark(input: ProjectProps): {tone: 'failed' | 'waiting' | 'running' | null; dotTitle?: string; buttonTitle: string} {
  const label = !input.available
    ? TEXT.unavailable
    : input.fileOperation?.state === 'failed'
      ? TEXT.needsRepair
      : input.activeRunStatus === 'waiting'
        ? input.activeRunReason === 'approval' ? TEXT.waitApproval : TEXT.waitReply
        : input.activeRunStatus
          ? TEXT.running
          : input.fileOperation
            ? TEXT.filesBusy
            : null
  const tone = !input.available || input.fileOperation?.state === 'failed'
    ? 'failed' as const
    : input.activeRunStatus === 'waiting'
      ? 'waiting' as const
      : input.activeRunStatus || input.fileOperation
        ? 'running' as const
        : null
  const details = [
    !input.available ? input.reason : null,
    input.fileOperation?.error,
    label,
    input.archived ? TEXT.archived : null,
  ].filter((item): item is string => !!item).join('；')
  return {
    tone,
    dotTitle: details || label || undefined,
    buttonTitle: details ? `${input.name}：${details}` : input.name,
  }
}

function terminalWord(status: TerminalProps['status']): string {
  if (status === 'failed') return TEXT.failed
  if (status === 'cancelled') return TEXT.cancelled
  return TEXT.interrupted
}

/** 输入框的 placeholder 只能是字符串，所以这四句和组件放在同一处，不另起判断函数。 */
export const RUN_INPUT_HINT = {
  reply: '回复将继续当前任务',
  approval: '先批准或拒绝，或点暂停结束运行',
  running: '补充要求，会在当前这批操作结束后读取',
  idle: '描述下一步，或开始一次新的运行',
} as const

export function RunStatus(props: RunStatusProps): ReactNode {
  const markRef = useRef<HTMLSpanElement>(null)
  const buttonTitle = props.place === 'project' ? projectMark(props).buttonTitle : null
  useLayoutEffect(() => {
    if (!buttonTitle) return
    const button = markRef.current?.closest('button')
    if (button) button.title = buttonTitle
  }, [buttonTitle])

  switch (props.place) {
    case 'timeline': {
      const text = timelineSentence(props)
      if (!text) return null
      return (
        <div role="status" aria-live="polite" className={cn('flex min-w-0 items-center gap-2 text-sm text-muted-foreground', props.className)}>
          <Loader2 className="size-4 shrink-0 animate-spin text-state-running" aria-hidden/>
          <span className="min-w-0 truncate" title={text}>{text}</span>
        </div>
      )
    }
    case 'sidebar': {
      const word = sidebarWord(props.status, props.waitKind, props.compacting)
      return (
        <>
          <span id={props.id} className="sr-only">{`${props.title}，${word.label}`}</span>
          {word.attention ? (
            <span aria-hidden className={cn(SIDEBAR_META, word.tone)}>{word.label}</span>
          ) : props.showTime && props.time ? (
            <span className={cn(SIDEBAR_META, 'text-muted-foreground')}>{props.time}</span>
          ) : null}
        </>
      )
    }
    case 'headline': {
      if (props.compacting || (props.status !== 'completed' && props.status !== 'cancelled')) return null
      return (
        <span role="status" className={cn('shrink-0 text-xs text-muted-foreground', props.className)}>
          {props.status === 'completed' ? TEXT.completed : TEXT.cancelled}
        </span>
      )
    }
    case 'ask':
      return props.answered ? TEXT.replied : TEXT.waitReply
    case 'approval':
      return props.pending ? TEXT.waitApproval : TEXT.approvalRecord
    case 'terminal':
      return terminalWord(props.status)
    case 'project': {
      const mark = projectMark(props)
      return (
        <>
          {mark.tone ? (
            <span
              ref={markRef}
              title={mark.dotTitle}
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                mark.tone === 'failed' ? 'bg-state-failed' : mark.tone === 'waiting' ? 'bg-state-waiting' : 'bg-state-running',
              )}
            />
          ) : <span ref={markRef} className="hidden"/>}
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={mark.buttonTitle}>{props.name}</span>
        </>
      )
    }
  }
}
