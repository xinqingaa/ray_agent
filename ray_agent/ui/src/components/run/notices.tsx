import {Layers, RotateCw, TriangleAlert} from 'lucide-react'
import {cn} from '@/lib/utils'
import {formatTokens} from './format'

type CompactionNoticeProps = {
  beforeTokens: number
  afterTokens: number
  summarizedTurns: number
  className?: string
}

/** 压缩提示：一行说明压缩了多少轮与前后估算量；摘要全文在开发者视图 */
export function CompactionNotice({beforeTokens, afterTokens, summarizedTurns, className}: CompactionNoticeProps) {
  return (
    <div role="note" className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      <span className="h-px flex-1 bg-border" aria-hidden/>
      <span className="inline-flex items-center gap-1.5">
        <Layers className="size-3.5" aria-hidden/>
        已把较早的 {summarizedTurns} 轮压缩为摘要，上下文约
        <span className="tabular-nums text-foreground">{formatTokens(beforeTokens)}</span>
        降到
        <span className="tabular-nums text-foreground">{formatTokens(afterTokens)}</span>
        tokens
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
