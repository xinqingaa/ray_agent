'use client'

import type {KeyboardEvent} from 'react'
import {Check, Loader2, ShieldQuestion, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Kbd} from '@/components/ui/kbd'
import {cn} from '@/lib/utils'
import type {ApprovalStatus, ToolCallView} from '@/lib/session-view'
import {formatTime} from './format'
import {FAMILY} from './status-meta'

type ApprovalCardProps = {
  call: ToolCallView
  status: ApprovalStatus
  decidedAt?: number | null
  /** 已点击、等待接口返回的一方 */
  submitting?: 'approve' | 'reject' | null
  onApprove?: () => void
  onReject?: () => void
  /** 批准后在工作台查看这次调用 */
  onOpen?: () => void
  className?: string
}

const KEY_ARG: Partial<Record<ToolCallView['family'], {key: string; label: string}>> = {
  shell: {key: 'command', label: '命令'},
  file: {key: 'filepath', label: '文件'},
  browser: {key: 'url', label: '网址'},
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
}

const RESULT_TEXT: Record<Exclude<ApprovalStatus, 'pending'>, {text: string; tone: string}> = {
  approved: {text: '已批准，只执行这一次', tone: 'text-state-success'},
  rejected: {text: '已拒绝，Agent 收到“用户拒绝执行”', tone: 'text-state-stopped'},
  expired: {text: '已失效，这次调用没有执行。运行结束的原因见下方', tone: 'text-state-interrupted'},
}

/** 批准后的执行情况：执行中、结果摘要或失败说明 */
function outcomeText(call: ToolCallView): string | null {
  if (call.status === 'running') return '正在执行'
  if (call.result?.error) return call.result.error
  if (call.status === 'succeeded') return call.result?.summary ? `执行完成：${call.result.summary}` : '执行完成'
  return null
}

/**
 * 审批卡：执行前需要操作者确认的工具调用。焦点在卡片内时按 Y 批准、N 拒绝。
 * “提交中”由调用方通过 submitting 传入；批准后可打开工作台查看结果。
 */
export function ApprovalCard({call, status, decidedAt, submitting = null, onApprove, onReject, onOpen, className}: ApprovalCardProps) {
  const args = call.raw.args ?? {}
  const keyArg = KEY_ARG[call.family]
  const highlighted = keyArg && args[keyArg.key] != null ? stringify(args[keyArg.key]) : null
  const rest = Object.entries(args).filter(([k]) => !(highlighted != null && k === keyArg?.key))
  const pending = status === 'pending'
  const busy = submitting != null
  const FamilyIcon = FAMILY[call.family].icon

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!pending || busy || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"]')) return
    if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault()
      onApprove?.()
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      onReject?.()
    }
  }

  return (
    <div
      role="group"
      aria-label={`审批：${call.title}`}
      onKeyDown={onKeyDown}
      className={cn(
        'rounded-lg border px-3.5 py-3',
        pending ? 'border-state-waiting/50 bg-card' : 'bg-card',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldQuestion className={cn('size-4', pending ? 'text-state-waiting' : 'text-muted-foreground')} aria-hidden/>
        <span className={cn('text-xs font-medium', pending ? 'text-state-waiting' : 'text-muted-foreground')}>
          {pending ? '需要你批准后才会执行' : '审批记录'}
        </span>
        <code className="ml-auto font-mono text-xs text-faint">{call.toolset}.{call.name}</code>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <FamilyIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
        <span className="text-sm font-medium">{call.verb}</span>
      </div>

      {highlighted != null && keyArg && (
        <div className="mt-2">
          <div className="mb-1 text-xs text-muted-foreground">{keyArg.label}</div>
          <pre className={cn(
            'max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border-l-2 bg-muted px-3 py-2 font-mono text-[13px] leading-6',
            pending ? 'border-state-waiting' : 'border-border',
          )}>
            {highlighted}
          </pre>
        </div>
      )}
      {rest.length > 0 && (
        <dl className="mt-2 space-y-1 text-xs">
          {rest.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3">
              <dt className="font-mono text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate font-mono" title={stringify(v)}>{stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={onApprove} disabled={busy || !onApprove} aria-keyshortcuts="Y">
            {submitting === 'approve' ? <Loader2 className="animate-spin" aria-hidden/> : <Check aria-hidden/>}
            {submitting === 'approve' ? '正在批准' : '批准'}
            <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Y</Kbd>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy || !onReject} aria-keyshortcuts="N">
            {submitting === 'reject' ? <Loader2 className="animate-spin" aria-hidden/> : <X aria-hidden/>}
            {submitting === 'reject' ? '正在拒绝' : '拒绝'}
            <Kbd className="ml-1">N</Kbd>
          </Button>
          <span className="text-xs text-muted-foreground">批准只对这一次调用有效</span>
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-xs">
          <p className={RESULT_TEXT[status].tone}>
            {RESULT_TEXT[status].text}
            {decidedAt != null && <span className="ml-2 tabular-nums text-muted-foreground">{formatTime(decidedAt)}</span>}
          </p>
          {status === 'approved' && outcomeText(call) && (
            <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <span className={call.status === 'failed' ? 'text-state-failed' : undefined}>{outcomeText(call)}</span>
              {onOpen && call.status !== 'running' && (
                <button
                  type="button"
                  onClick={onOpen}
                  className="rounded-sm text-signal underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  在工作台查看
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
