import {Layers, Loader2, RotateCw, TriangleAlert} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {CompactTrigger} from '@/lib/session-view'
import {formatTokens} from './format'

const HEADLINE: Record<CompactTrigger, string> = {
  manual: '你手动压缩了上下文',
  watermark: '上下文接近上限，已自动压缩',
  overflow: '请求超出窗口，已压缩后重试',
}

type CompactionNoticeProps = {
  beforeTokens: number
  afterTokens: number
  summarizedTurns: number
  trigger: CompactTrigger
  className?: string
}

/** 运行前快照的保护降级或失败。文案用事件里的原因，出现在任何工具条目之前。 */
export function ProtectionNotice({message, state, className}: {message: string; state: 'skipped' | 'failed'; className?: string}) {
  return (
    <div role="status" className={cn('flex items-center gap-3 text-xs', state === 'failed' ? 'text-state-failed' : 'text-state-waiting', className)}>
      <span className="h-px flex-1 bg-border" aria-hidden/>
      <span className="inline-flex max-w-[40rem] items-center gap-1.5 text-center">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden/>
        {message}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden/>
    </div>
  )
}

/** 沙箱容器尚未就绪时占在时间线末尾；环境就绪或失败后由后续条目替换 */
export function PreparingNotice({className}: {className?: string}) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-2 rounded-lg bg-state-running-soft px-3.5 py-2.5 text-sm', className)}>
      <Loader2 className="size-4 shrink-0 animate-spin text-state-running" aria-hidden/>
      <span>正在准备执行环境</span>
    </div>
  )
}

/** 点击压缩后、结果事件到达前，占在时间线末尾；结果写入后由真实摘要行替换 */
export function CompactingNotice({className}: {className?: string}) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      <span className="h-px flex-1 bg-border" aria-hidden/>
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-state-running" aria-hidden/>
        压缩中
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden/>
    </div>
  )
}

/** 压缩提示：一行说明触发原因与前后估算量；摘要全文在开发者视图 */
export function CompactionNotice({beforeTokens, afterTokens, summarizedTurns, trigger, className}: CompactionNoticeProps) {
  return (
    <div role="note" className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      <span className="h-px flex-1 bg-border" aria-hidden/>
      <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
        <Layers className="size-3.5 shrink-0" aria-hidden/>
        <span>{trigger === 'manual' && afterTokens >= beforeTokens ? '已摘要，估算空间未减少' : HEADLINE[trigger]}</span>
        {summarizedTurns > 0 && (
          <>
            <span>，摘要 {summarizedTurns} 轮，约</span>
            <span className="tabular-nums text-foreground">{formatTokens(beforeTokens)}</span>
            <span>→</span>
            <span className="tabular-nums text-foreground">{formatTokens(afterTokens)}</span>
            <span>tokens</span>
          </>
        )}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden/>
    </div>
  )
}

const ATTEMPT_REASON: Record<string, string> = {
  transport: '连接中断或超时',
  stream_interrupted: '输出流中断',
  empty: '空回复',
  model_error: '模型拒绝请求',
  cancelled: '已停止',
}

/** 这些原因在不再重试时，才是重试耗尽 */
const RETRY_EXHAUSTED = new Set(['transport', 'stream_interrupted', 'empty'])

type AttemptNoticeProps = {
  /** 本轮内第几次请求 */
  attempt: number
  /** 原因代码或已经写好的说明 */
  reason: string
  /** true：之后还会再请求一次 */
  retried: boolean
  /** 这次尝试已经推送的可见文本字符数 */
  chars?: number | null
  className?: string
}

function attemptSentence(attempt: number, reason: string, retried: boolean, chars?: number | null): string {
  const label = ATTEMPT_REASON[reason] ?? reason
  const received = chars != null && chars > 0 ? `，已收到 ${chars} 个字符` : ''
  if (reason === 'cancelled') return `第 ${attempt} 次请求已停止${received}`
  if (retried) return `第 ${attempt} 次请求失败：${label}${received}，已重试`
  const exhausted = RETRY_EXHAUSTED.has(reason) || !(reason in ATTEMPT_REASON)
  return exhausted
    ? `第 ${attempt} 次请求失败：${label}${received}，已达到重试上限，不再重试`
    : `第 ${attempt} 次请求失败：${label}${received}`
}

/** 失败尝试提示：模型请求失败、被取消或不进入模型历史的半截输出 */
export function AttemptNotice({attempt, reason, retried, chars, className}: AttemptNoticeProps) {
  const stopped = reason === 'cancelled'
  const Icon = retried ? RotateCw : TriangleAlert
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-1.5 text-xs',
        stopped ? 'text-muted-foreground' : retried ? 'text-state-waiting' : 'text-state-failed',
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
      <span>{attemptSentence(attempt, reason, retried, chars)}</span>
    </p>
  )
}
