import {CircleCheck, MessageCircleQuestion} from 'lucide-react'
import {MarkdownContent} from '@/components/markdown-content'
import {cn} from '@/lib/utils'

/** 输入框在等待回复时使用的提示文字 */
export const ASK_REPLY_PLACEHOLDER = '输入回复，回复将继续当前任务'

type AskCardProps = {
  question: string
  answered: boolean
  className?: string
}

/** 提问卡：Agent 调用提问后运行进入等待，回复从下方输入框发送 */
export function AskCard({question, answered, className}: AskCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-3',
        answered ? 'bg-card' : 'border-state-waiting/40 bg-state-waiting-soft/60',
        className,
      )}
    >
      <div className={cn('mb-1.5 flex items-center gap-1.5 text-xs font-medium', answered ? 'text-muted-foreground' : 'text-state-waiting')}>
        {answered ? <CircleCheck className="size-3.5" aria-hidden/> : <MessageCircleQuestion className="size-3.5" aria-hidden/>}
        {answered ? '已回复' : '需要你的回复'}
      </div>
      <MarkdownContent content={question} className={cn(answered && 'text-muted-foreground')}/>
      {!answered && (
        <p className="mt-2 text-xs text-muted-foreground">在下方输入框回复，回复将继续当前任务。</p>
      )}
    </div>
  )
}
