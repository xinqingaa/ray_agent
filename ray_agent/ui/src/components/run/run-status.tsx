import {ChevronDown, ChevronRight, CirclePause, CircleX, Loader2, type UiIcon, ShieldQuestion, Unplug} from '@/components/ui/icons'
import {useEffect, useRef, useState, type ReactNode} from 'react'
import {cn} from '@/lib/utils'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import type {SessionStatus} from '@/lib/api/types'
import {
  formatReasoningForPanel,
  formatToolProgressLabel,
  summarizeReasoningForHover,
} from '@/lib/session-projection'
import type {Activity, RunStatus as RunState, StreamProgressState} from '@/lib/session-view'
import type {WaitKind} from '@/providers/sessions-provider'
import {TONE_TEXT} from './status-meta'
import {useNow} from './clock'

/**
 * 用户看见的运行状态只在这里维护。
 * 调用方传入原始信号，组件自己决定词和怎么画。输入框提示见同文件的 RUN_INPUT_HINT。
 */
const TEXT = {
  thinking: '正在思考',
  deepThinking: '正在深度思考',
  preparing: '正在准备执行环境',
  stopping: '正在停止',
  compacting: '正在压缩上下文',
  compactingShort: '压缩中',
  running: '运行中',
  completed: '已完成',
  completedUnread: '已完成，尚未查看',
  failed: '失败',
  cancelled: '已停止生成',
  interrupted: '已中断',
  waitReply: '等你回复',
  waitApproval: '等你批准',
  waitUnknown: '等你',
  replied: '已回复',
  approvalRecord: '审批记录',
} as const

const SIDEBAR_META = 'session-row-meta flex min-w-6 shrink-0 items-center justify-end gap-1.5 pr-2 text-xs font-normal tabular-nums'

type TimelineProps = {
  place: 'timeline'
  compacting: boolean
  pendingSend: boolean
  activity?: Activity['kind'] | null
  /** 当前模型请求或停止请求的开始时刻；有值时在状态词后走秒 */
  since?: number | null
  streaming: boolean
  running: boolean
  liveProgress?: StreamProgressState | null
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
  /** 运行完成后用户还没打开过这个会话 */
  unread: boolean
  time: string
  showTime: boolean
}

type HeadlineProps = {
  outcome?: string
  place: 'headline'
  status?: RunState | null
  compacting: boolean
  className?: string
}

type AskProps = {place: 'ask'; answered: boolean}
type ApprovalProps = {place: 'approval'; pending: boolean}
type TerminalProps = {place: 'terminal'; status: Exclude<RunState, 'running' | 'waiting' | 'completed'>}

type RunStatusProps =
  | TimelineProps
  | SidebarProps
  | HeadlineProps
  | AskProps
  | ApprovalProps
  | TerminalProps

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
    if (activity === 'waiting_reply' || activity === 'waiting_approval') return null
    if (input.liveProgress?.phase === 'tool_call') {
      return formatToolProgressLabel(input.liveProgress.toolName, input.liveProgress.toolTarget, input.liveProgress.argBytes)
    }
    if (input.streaming) return null
    return input.liveProgress?.phase === 'reasoning' ? TEXT.deepThinking : TEXT.thinking
  }
  if (specific) return specific
  if (activity === 'waiting_reply' || activity === 'waiting_approval') return null
  if (input.running && (activity === 'model' || activity === 'idle' || activity == null)) {
    if (input.liveProgress?.phase === 'tool_call') {
      return formatToolProgressLabel(input.liveProgress.toolName, input.liveProgress.toolTarget, input.liveProgress.argBytes)
    }
    if (!input.streaming) {
      return input.liveProgress?.phase === 'reasoning' ? TEXT.deepThinking : TEXT.thinking
    }
  }
  return null
}

/** 侧栏状态：需要处理或正在进行的状态用图标占住时间位，未查看的完成在时间前加圆点；词只进提示和读屏。 */
type SidebarMark = {label: string; icon?: UiIcon; spin?: boolean; dot?: boolean; tone?: string}

function sidebarMark(status: SessionStatus, waitKind: WaitKind | null, compacting: boolean, unread: boolean): SidebarMark {
  if (compacting) return {label: TEXT.compactingShort, icon: Loader2, spin: true, tone: TONE_TEXT.running}
  switch (status) {
    case 'pending': return {label: ''}
    case 'running': return {label: TEXT.running, icon: Loader2, spin: true, tone: TONE_TEXT.running}
    case 'waiting':
      return {
        label: waitKind === 'approval' ? TEXT.waitApproval : waitKind === 'reply' ? TEXT.waitReply : TEXT.waitUnknown,
        icon: waitKind === 'approval' ? ShieldQuestion : CirclePause,
        tone: TONE_TEXT.waiting,
      }
    case 'failed': return {label: TEXT.failed, icon: CircleX, tone: TONE_TEXT.failed}
    case 'interrupted': return {label: TEXT.interrupted, icon: Unplug, tone: TONE_TEXT.interrupted}
    case 'completed': return unread ? {label: TEXT.completedUnread, dot: true} : {label: TEXT.completed}
    case 'cancelled': return {label: TEXT.cancelled}
  }
}

/** 会话行的悬停提示：标题加上状态词 */
export function sidebarTitle(title: string, status: SessionStatus, waitKind: WaitKind | null, compacting: boolean, unread: boolean): string {
  const {label} = sidebarMark(status, waitKind, compacting, unread)
  return label ? `${title}（${label}）` : title
}

function terminalWord(status: TerminalProps['status']): string {
  if (status === 'failed') return TEXT.failed
  if (status === 'cancelled') return TEXT.cancelled
  return TEXT.interrupted
}

/** 输入框的 placeholder 只能是字符串，所以这四句和组件放在同一处，不另起判断函数。 */
export const RUN_INPUT_HINT = {
  reply: '回复将继续当前任务',
  approval: '先批准或拒绝，或点停止生成结束运行',
  running: '补充要求，会在当前这批操作结束后读取',
  idle: '继续这次对话……',
} as const

/** 进行中的状态行与工具行左对齐；文字微光表示仍在处理，走秒只算当前这次请求；有实时思考时支持悬停预览与点击展开。 */
function TimelineStatus({
  text,
  since,
  liveProgress,
  className,
}: {
  text: string
  since?: number | null
  liveProgress?: StreamProgressState | null
  className?: string
}) {
  const now = useNow(since != null)
  const waited = since != null && now != null ? Math.max(0, Math.floor((now - since) / 1000)) : null
  const progressKey = liveProgress ? `${liveProgress.runId}:${liveProgress.turn}:${liveProgress.attempt}` : null
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [fullKey, setFullKey] = useState<string | null>(null)
  const expanded = progressKey != null && expandedKey === progressKey
  const showFull = progressKey != null && fullKey === progressKey
  const reasoningText = liveProgress?.reasoningText.trim() ?? ''
  const hasReasoning = reasoningText.length > 0 && progressKey != null
  const previewText = hasReasoning ? summarizeReasoningForHover(reasoningText) : ''
  const panel = hasReasoning ? formatReasoningForPanel(reasoningText, showFull) : null
  const scrollRef = useRef<HTMLDivElement>(null)
  const followBottomRef = useRef(true)

  useEffect(() => {
    followBottomRef.current = true
  }, [progressKey, expanded])

  useEffect(() => {
    if (!expanded) return
    const el = scrollRef.current
    if (el && followBottomRef.current) el.scrollTop = el.scrollHeight
  }, [expanded, reasoningText])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    followBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
  }

  const toggleButton = hasReasoning ? (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpandedKey(expanded ? null : progressKey)}
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {expanded ? <ChevronDown className="size-3" aria-hidden/> : <ChevronRight className="size-3" aria-hidden/>}
      <span>{expanded ? '收起思考' : liveProgress?.phase === 'tool_call' ? '思考过程' : '查看思考'}</span>
    </button>
  ) : null

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div role="status" aria-live="polite" className="flex min-h-8 w-full min-w-0 items-center gap-2 px-1.5 text-meta">
        <span aria-hidden className="relative flex size-3.5 shrink-0 items-center justify-center">
          <span className="absolute size-2 rounded-full bg-state-running/25 animate-[status-halo_1.8s_ease-out_infinite] motion-reduce:hidden"/>
          <span className="size-1.5 rounded-full bg-state-running"/>
        </span>
        <span className="text-shimmer min-w-0 truncate" title={text}>{text}</span>
        {waited != null && waited > 0 && <span className="shrink-0 text-xs tabular-nums text-faint" aria-hidden>{waited}s</span>}
        {toggleButton && (
          expanded ? toggleButton : (
            <Tooltip delayDuration={280}>
              <TooltipTrigger asChild>{toggleButton}</TooltipTrigger>
              <TooltipContent side="bottom" align="start" sideOffset={6} className="max-w-md space-y-1.5 p-3 text-xs leading-relaxed text-muted-foreground">
                <div className="max-h-32 overflow-hidden whitespace-pre-wrap break-words">{previewText}</div>
                <p className="text-[11px] text-faint">点击展开实时思考</p>
              </TooltipContent>
            </Tooltip>
          )
        )}
      </div>
      {hasReasoning && expanded && panel && (
        <div className="ml-6 mt-1 mb-2 rounded-lg border border-border/60 bg-muted/30">
          {(panel.truncated || showFull) && (
            <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1 text-[11px] text-faint">
              <span>
                {showFull
                  ? `完整原文（${panel.totalChars.toLocaleString()} 字）`
                  : panel.omittedBlocks > 0
                    ? `已自动折叠 ${panel.omittedBlocks} 处代码草稿，仅显示近期思考摘要`
                    : '仅显示近期思考尾部内容'}
              </span>
              <button
                type="button"
                onClick={() => setFullKey(showFull ? null : progressKey)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showFull ? '切回降噪摘要' : '查看完整原文'}
              </button>
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-52 overflow-y-auto px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
          >
            {panel.text}
          </div>
        </div>
      )}
    </div>
  )
}

export function RunStatus(props: RunStatusProps): ReactNode {
  switch (props.place) {
    case 'timeline': {
      const text = timelineSentence(props)
      if (!text) return null
      return <TimelineStatus text={text} since={props.since} liveProgress={props.liveProgress} className={props.className}/>
    }
    case 'sidebar': {
      const mark = sidebarMark(props.status, props.waitKind, props.compacting, props.unread)
      const Icon = mark.icon
      const time = props.showTime && props.time ? <span className="truncate">{props.time}</span> : null
      return (
        <>
          <span id={props.id} className="sr-only">{mark.label ? `${props.title}，${mark.label}` : props.title}</span>
          {Icon ? (
            <span aria-hidden className={cn(SIDEBAR_META, mark.tone)}>
              <Icon className={cn('size-4 shrink-0', mark.spin && 'animate-spin motion-reduce:animate-none')} strokeWidth={2.25}/>
            </span>
          ) : mark.dot ? (
            <span aria-hidden className={cn(SIDEBAR_META, 'font-medium text-foreground')}>
              <span className="size-2 shrink-0 rounded-full bg-state-success ring-2 ring-state-success-soft"/>
              {time}
            </span>
          ) : time ? (
            <span aria-hidden className={cn(SIDEBAR_META, 'text-muted-foreground')}>{time}</span>
          ) : null}
        </>
      )
    }
    case 'headline': {
      if (props.compacting || props.status !== 'completed') return null
      return (
        <span role="status" className={cn('shrink-0 text-xs text-muted-foreground', props.className)}>
          {props.outcome === 'partial' ? '仍有未完成项' : TEXT.completed}
        </span>
      )
    }
    case 'ask':
      return props.answered ? TEXT.replied : TEXT.waitReply
    case 'approval':
      return props.pending ? TEXT.waitApproval : TEXT.approvalRecord
    case 'terminal':
      return terminalWord(props.status)
  }
}
