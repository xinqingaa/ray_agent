import {AlertCircle, Check} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'

/** 操作结果：failed 为失败，warning 为需要注意的结论，其余为成功；action 为行内的一个确认或重试操作。 */
export type ProbeNote = {text: string; failed?: boolean; warning?: boolean; action?: {label: string; onClick: () => void}}

export function ProviderResult({note}: {note: ProbeNote}) {
  const Mark = note.failed || note.warning ? AlertCircle : Check
  const tone = note.failed ? 'text-state-failed' : note.warning ? 'text-state-waiting' : 'text-state-success'
  return <p role={note.failed ? 'alert' : 'status'} className={cn('provider-result', tone)}>
    <Mark aria-hidden className="mt-0.5 size-3.5 shrink-0"/>
    <span className="min-w-0">{note.text}</span>
    {note.action && <Button type="button" size="sm" variant="outline" className="provider-result-action" onClick={note.action.onClick}>{note.action.label}</Button>}
  </p>
}
