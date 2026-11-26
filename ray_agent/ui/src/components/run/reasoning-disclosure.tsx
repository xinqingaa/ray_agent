import {useState} from 'react'
import {ChevronRight} from '@/components/ui/icons'
import {cn} from '@/lib/utils'
import {formatDuration, formatTokens} from './format'

export function ReasoningDisclosure({
  content,
  reasoningTokens,
  modelMs,
  defaultOpen = false,
  className,
}: {
  content?: string | null
  reasoningTokens?: number | null
  modelMs?: number | null
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const text = content?.trim() ?? ''
  const hasTokens = reasoningTokens != null && reasoningTokens > 0

  if (!text && !hasTokens) return null

  if (!text) {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs text-faint tabular-nums', className)}>
        <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden/>
        <span>已思考（当前模型未返回思考摘要 · {formatTokens(reasoningTokens)}）</span>
      </div>
    )
  }

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/65 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-(--motion-fast) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="font-medium">思考过程</span>
        {(modelMs != null || hasTokens) && (
          <span className="truncate text-faint tabular-nums">
            {modelMs != null && <span>· {formatDuration(modelMs)}</span>}
            {hasTokens && <span>{modelMs != null ? ' ' : '· '}{formatTokens(reasoningTokens)} 思考</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-border/75 bg-muted/35 px-3.5 py-2.5 text-meta leading-relaxed whitespace-pre-wrap text-muted-foreground [scrollbar-width:thin]">
          {text}
        </div>
      )}
    </div>
  )
}
