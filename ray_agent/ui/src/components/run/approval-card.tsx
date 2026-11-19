import type {KeyboardEvent} from 'react'
import {Check, ChevronRight, Loader2, ShieldQuestion, X} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {Kbd} from '@/components/ui/kbd'
import {cn} from '@/lib/utils'
import type {ApprovalStatus, ToolCallView} from '@/lib/session-view'
import {formatTime} from './format'
import {RunStatus} from './run-status'

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
const EXECUTION_SCOPE: Partial<Record<ToolCallView['family'], string>> = {
  shell: '本机执行',
  file: '本地文件',
  browser: '浏览器',
  mcp: '外部工具',
  a2a: '远程协作',
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
  const scope = EXECUTION_SCOPE[call.family]

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
        'rounded-[14px] border px-3.5 py-3',
        pending ? 'border-state-waiting/30 bg-state-waiting-soft/45' : 'border-border/70 bg-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <ShieldQuestion className={cn('mt-0.5 size-4 shrink-0', pending ? 'text-state-waiting' : 'text-muted-foreground')} aria-hidden/>
        <h3 className="min-w-28 flex-1 text-sm font-semibold wrap-anywhere">{call.verb}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className={pending ? 'text-state-waiting' : undefined}><RunStatus place="approval" pending={pending}/></span>
          {scope && <><span aria-hidden>·</span><span>{scope}</span></>}
        </div>
      </div>

      {highlighted == null && call.target && <p className="mt-2 text-sm wrap-anywhere">{call.target}</p>}
      {highlighted != null && keyArg && (
        <div className="mt-2.5">
          <pre aria-label={keyArg.label} tabIndex={0}
            className="max-h-40 overflow-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere">
            {highlighted}
          </pre>
        </div>
      )}
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="size-3.5 group-open:rotate-90" aria-hidden/>调用详情
        </summary>
        <code className="block py-1 font-mono text-xs text-faint wrap-anywhere">{call.toolset}.{call.name}</code>
        <dl className="space-y-1 text-xs">
          {rest.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(4rem,30%)_minmax(0,1fr)] gap-x-3">
              <dt className="font-mono text-muted-foreground wrap-anywhere">{k}</dt>
              <dd className="min-w-0 font-mono whitespace-pre-wrap wrap-anywhere">{stringify(v)}</dd>
            </div>
          ))}
        </dl>
      </details>

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={onApprove} disabled={busy || !onApprove} aria-keyshortcuts="Y">
            {submitting === 'approve' ? <Loader2 className="animate-spin" aria-hidden/> : <Check aria-hidden/>}
            {submitting === 'approve' ? '正在批准' : '批准这一次'}
            <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Y</Kbd>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onReject} disabled={busy || !onReject} aria-keyshortcuts="N">
            {submitting === 'reject' ? <Loader2 className="animate-spin" aria-hidden/> : <X aria-hidden/>}
            {submitting === 'reject' ? '正在拒绝' : '拒绝'}
            <Kbd className="ml-1">N</Kbd>
          </Button>
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
