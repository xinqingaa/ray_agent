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

type AttemptNoticeProps = {
  /** 本轮内第几次请求 */
  attempt: number
  reason: string
  /** true：之后已重试；false：这是最后一次，运行因此失败 */
  retried: boolean
  className?: string
}

/** 失败尝试提示（W6 接入 attempt 事件）：模型请求失败但不进入模型历史 */
export function AttemptNotice({attempt, reason, retried, className}: AttemptNoticeProps) {
  const Icon = retried ? RotateCw : TriangleAlert
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-1.5 text-xs',
        retried ? 'text-state-waiting' : 'text-state-failed',
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
      <span>
        第 {attempt} 次请求失败：{reason}
        {retried ? '，已重试' : '，已达到重试上限，不再重试'}
      </span>
    </p>
  )
}
