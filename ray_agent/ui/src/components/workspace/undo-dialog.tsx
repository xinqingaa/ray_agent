import {useCallback, useEffect, useRef, useState} from 'react'
import {AlertTriangle, ChevronDown, ChevronRight} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {ScrollArea} from '@/components/ui/scroll-area'
import {Skeleton} from '@/components/ui/skeleton'
import {formatBytes} from '@/components/run/format'
import {useSessionTitle} from '@/hooks/use-session-title'
import {ApiError} from '@/lib/api/fetch'
import {historyApi} from '@/lib/api/workspace'
import type {ChangeEntry, ChangePreview, ModifiedRun, RunChanges, UndoItemRequest, UndoItemResult} from '@/lib/api/types'
import {
  buildUndoItems, forceRetryItem, initialSelection, isUndoable, leaseConflictText, leaseFromDetails, mergeResults,
  NO_SELECTION, setSelected, summarizeResults, type UndoSelection,
} from '@/lib/workspace-changes'
import {cn} from '@/lib/utils'

const OPERATION: Record<ChangeEntry['operation'], string> = {create: '新建', modify: '修改', delete: '删除'}
const ACTION: Record<ChangeEntry['preview_kind'], string> = {remove: '撤销会移除这个文件', restore: '撤销会恢复运行前的内容'}
const CONFLICT: Record<NonNullable<ChangeEntry['conflict_reason']>, string> = {
  modified: '运行之后文件又被改动过',
  missing: '运行之后文件已不存在',
  appeared: '这个位置现在有了别的文件',
  not_file: '这个位置现在不是普通文件',
  modified_during_run: '运行期间文件被外部改动过，撤销会同时丢掉这些改动',
}
const RESULT_LABEL: Record<UndoItemResult['status'], string> = {
  restored: '已恢复', removed: '已移除', unchanged: '无需改动', conflict: '冲突', failed: '失败',
}

function sizeText(size: number | null | undefined) {
  return size == null ? '不存在' : formatBytes(size)
}

/** 到撤销后内容的统一 diff；二进制与过大文件只说明大小。 */
function ChangePreviewBlock({workspaceId, runId, path}: {workspaceId: string; runId: string; path: string}) {
  const [state, setState] = useState<{phase: 'loading'} | {phase: 'error'; message: string} | {phase: 'ready'; preview: ChangePreview}>({phase: 'loading'})
  useEffect(() => {
    let cancelled = false
    historyApi.preview(workspaceId, runId, path)
      .then(preview => {if (!cancelled) setState({phase: 'ready', preview})})
      .catch(error => {if (!cancelled) setState({phase: 'error', message: error instanceof Error ? error.message : '读取预览失败'})})
    return () => {cancelled = true}
  }, [workspaceId, runId, path])

  if (state.phase === 'loading') return <Skeleton className="mt-2 h-16 w-full"/>
  if (state.phase === 'error') return <p role="alert" className="mt-2 text-xs text-state-failed">{state.message}</p>
  const {preview} = state
  return <div className="mt-2 space-y-1.5">
    {preview.removes_file && <p className="text-xs text-muted-foreground">撤销会移除这个文件（运行新建的文件）。</p>}
    {preview.kind === 'unchanged' && <p className="text-xs text-muted-foreground">撤销不会改变这个文件的内容。</p>}
    {preview.kind === 'binary' && <p className="text-xs text-muted-foreground">二进制文件，不显示内容。当前 {sizeText(preview.current_size)}，撤销后 {sizeText(preview.restore_size)}。</p>}
    {preview.kind === 'too_large' && <p className="text-xs text-muted-foreground">文件过大，不显示内容差异。当前 {sizeText(preview.current_size)}，撤销后 {sizeText(preview.restore_size)}。</p>}
    {preview.kind === 'diff' && <>
      <pre tabIndex={0} aria-label="撤销后的内容差异" className="max-h-60 overflow-auto rounded-md border bg-muted/40 py-1 font-mono text-xs leading-5">
        {preview.diff.split('\n').map((line, index) => <span key={index} className={cn(
          'block min-w-max px-2 whitespace-pre',
          line.startsWith('+') && !line.startsWith('+++') && 'bg-state-success-soft text-state-success',
          line.startsWith('-') && !line.startsWith('---') && 'bg-state-failed-soft text-state-failed',
          line.startsWith('@@') && 'text-muted-foreground',
        )}>{line || ' '}</span>)}
      </pre>
      {preview.truncated && <p className="text-xs text-muted-foreground">差异过长，只显示了前面一部分。</p>}
    </>}
  </div>
}

function EntryRow({workspaceId, runId, entry, selection, disabled, onSelect}: {
  workspaceId: string
  runId: string
  entry: ChangeEntry
  selection: UndoSelection
  disabled: boolean
  onSelect: (entry: ChangeEntry, on: boolean) => void
}) {
  const [showing, setShowing] = useState(false)
  const checked = selection.selected.has(entry.relative_path)
  const conflict = entry.status === 'conflict'
  const restored = entry.status === 'restored'
  return <li className="px-3 py-2.5">
    <div className="flex items-start gap-2.5">
      <div className="flex h-5 w-4 shrink-0 items-center justify-center">
        {conflict
          ? <AlertTriangle className="size-4 text-state-waiting" aria-hidden/>
          : <input type="checkbox" className="size-4 accent-signal" checked={checked} disabled={disabled || restored}
              aria-label={`撤销 ${entry.relative_path}`} onChange={event => onSelect(entry, event.target.checked)}/>}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-all font-mono text-xs leading-5" dir="auto">{entry.relative_path}</p>
        <p className="text-xs text-muted-foreground">
          {OPERATION[entry.operation]}{entry.writes > 1 ? `（写入 ${entry.writes} 次）` : ''} · {restored ? '已经是运行前的状态' : ACTION[entry.preview_kind]}
        </p>
        {conflict && <div className="space-y-1 rounded-md bg-state-waiting-soft px-2.5 py-1.5 text-xs">
          <p className="text-state-waiting">冲突：{entry.conflict_reason ? CONFLICT[entry.conflict_reason] : '当前内容与运行结束时不同'}。默认不撤销。</p>
          {entry.can_force
            ? <label className="flex items-center gap-1.5 text-foreground">
                <input type="checkbox" className="size-3.5 accent-signal" checked={checked} disabled={disabled}
                  onChange={event => onSelect(entry, event.target.checked)}/>
                仍要覆盖当前内容
              </label>
            : <p className="text-muted-foreground">这一项不能强行覆盖，请自行处理。</p>}
        </div>}
        {!restored && <button type="button" aria-expanded={showing} onClick={() => setShowing(value => !value)}
          className="inline-flex items-center gap-0.5 rounded-sm text-xs text-signal outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {showing ? <ChevronDown className="size-3.5" aria-hidden/> : <ChevronRight className="size-3.5" aria-hidden/>}
          查看变化
        </button>}
        {showing && <ChangePreviewBlock workspaceId={workspaceId} runId={runId} path={entry.relative_path}/>}
      </div>
    </div>
  </li>
}

function ResultRow({result, busy, onForce}: {result: UndoItemResult; busy: boolean; onForce: (item: UndoItemRequest) => void}) {
  const retry = forceRetryItem(result)
  const ok = result.status === 'restored' || result.status === 'removed'
  return <li className="flex items-start gap-2.5 px-3 py-2.5">
    <span className={cn('mt-0.5 w-14 shrink-0 text-xs font-medium',
      ok ? 'text-state-success' : result.status === 'unchanged' ? 'text-muted-foreground' : result.status === 'conflict' ? 'text-state-waiting' : 'text-state-failed')}>
      {RESULT_LABEL[result.status]}
    </span>
    <div className="min-w-0 flex-1 space-y-0.5">
      <p className="break-all font-mono text-xs leading-5" dir="auto">{result.relative_path}</p>
      {result.message && <p className="text-xs text-muted-foreground">{result.message}</p>}
    </div>
    {retry && <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => onForce(retry)}>仍要覆盖</Button>}
  </li>
}

function LeaseConflict({lease}: {lease: NonNullable<ReturnType<typeof leaseFromDetails>>}) {
  const title = useSessionTitle(lease.owner_session_id)
  return <>{leaseConflictText(lease, title)}</>
}

type Load = {phase: 'loading'} | {phase: 'error'; message: string} | {phase: 'ready'; changes: RunChanges}

/** 同一时刻只保留一个撤销窗口，避免运行底部与最近修改各开一个叠在一起。 */
const undoDialogs = new EventTarget()

/**
 * 撤销一次运行对文件夹的修改：列出每个文件的操作与状态，默认选中可直接撤销的，冲突项需要明确“仍要覆盖”。
 * 提交后逐项显示结果；撤销只恢复文件，不改变对话与记忆。
 */
export function UndoRunDialog({workspaceId, runId, kind = 'run', open, onOpenChange, onChanged}: {
  workspaceId: string
  runId: string | null
  /** 撤销操作本身也有变更记录，可以像运行一样撤回 */
  kind?: ModifiedRun['kind']
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 提交过撤销（不论结果）后调用，用于刷新文件树与记录 */
  onChanged: () => void
}) {
  const [load, setLoad] = useState<Load>({phase: 'loading'})
  const [selection, setSelection] = useState<UndoSelection>(NO_SELECTION)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<UndoItemResult[] | null>(null)
  const [failure, setFailure] = useState<{message: string; lease: ReturnType<typeof leaseFromDetails>} | null>(null)
  const submittingRef = useRef(submitting)
  submittingRef.current = submitting

  useEffect(() => {
    if (!open) return
    undoDialogs.dispatchEvent(new Event('open'))
    const onOther = () => {if (!submittingRef.current) onOpenChange(false)}
    undoDialogs.addEventListener('open', onOther)
    return () => undoDialogs.removeEventListener('open', onOther)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open || !runId) return
    let cancelled = false
    setLoad({phase: 'loading'})
    setResults(null)
    setFailure(null)
    historyApi.runChanges(workspaceId, runId)
      .then(changes => {
        if (cancelled) return
        setLoad({phase: 'ready', changes})
        setSelection(initialSelection(changes.entries))
      })
      .catch(error => {if (!cancelled) setLoad({phase: 'error', message: error instanceof Error ? error.message : '读取修改记录失败'})})
    return () => {cancelled = true}
  }, [open, workspaceId, runId])

  const submit = useCallback(async (items: UndoItemRequest[]) => {
    if (!runId || !items.length) return
    setSubmitting(true)
    setFailure(null)
    try {
      const next = await historyApi.undo(workspaceId, runId, items)
      setResults(current => mergeResults(current ?? [], next))
      onChanged()
    } catch (error) {
      setFailure({
        message: error instanceof Error ? error.message : '撤销失败，请重试',
        lease: error instanceof ApiError && error.code === 'conflict' ? leaseFromDetails(error.details) : null,
      })
      onChanged()
    } finally {setSubmitting(false)}
  }, [workspaceId, runId, onChanged])

  const changes = load.phase === 'ready' ? load.changes : null
  const entries = changes?.entries ?? []
  const items = buildUndoItems(entries, selection)
  const summary = results ? summarizeResults(results) : null
  const blocked = changes?.run_active === true
  const undoing = kind === 'undo'
  const nothing = changes != null && !blocked && !entries.some(isUndoable)

  return <Dialog open={open} onOpenChange={next => {if (!submitting) onOpenChange(next)}}>
    <DialogContent className="flex max-h-[min(720px,90vh)] flex-col gap-4 sm:max-w-[640px]"
      onPointerDownOutside={event => {if (submitting || results) event.preventDefault()}}
      onFocusOutside={event => {if (submitting || results) event.preventDefault()}}
      onInteractOutside={event => {if (submitting || results) event.preventDefault()}}
      onEscapeKeyDown={event => {if (submitting) event.preventDefault()}}>
      <DialogHeader>
        <DialogTitle>{undoing ? '撤回这次撤销' : '撤销本次修改'}</DialogTitle>
        <DialogDescription>
          {undoing
            ? '这次撤销恢复或移除了文件夹里的文件。撤回会把它们改回撤销之前的内容，不会改变对话和记忆；覆盖前会先备份当前版本。'
            : `${changes?.session_title ? `「${changes.session_title}」` : '这次运行'}修改了文件夹里的文件。撤销只恢复文件内容，不会改变对话和记忆；恢复或移除前会先备份当前版本。`}
        </DialogDescription>
      </DialogHeader>

      {load.phase === 'loading' && <div role="status" aria-label="正在读取修改记录" className="space-y-2"><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/></div>}
      {load.phase === 'error' && <p role="alert" className="text-sm text-state-failed">{load.message}</p>}
      {blocked && <p role="status" className="rounded-md bg-state-waiting-soft px-3 py-2 text-sm text-state-waiting">这次运行还在进行，结束后才能撤销。</p>}
      {nothing && !results && <p role="status" className="text-sm text-muted-foreground">{undoing ? '这次撤销涉及的文件都已回到撤销之前的状态，没有可撤回的内容。' : '这次运行修改的文件都已是运行前的状态，没有可撤销的内容。'}</p>}

      {changes && !blocked && !results && entries.length > 0 && <>
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <ul className="divide-y">
            {entries.map(entry => <EntryRow key={entry.relative_path} workspaceId={workspaceId} runId={changes.run_id} entry={entry}
              selection={selection} disabled={submitting} onSelect={(target, on) => setSelection(current => setSelected(current, target, on))}/>)}
          </ul>
        </ScrollArea>
      </>}

      {results && <>
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <ul className="divide-y">
            {results.map(result => <ResultRow key={result.relative_path} result={result} busy={submitting} onForce={item => void submit([item])}/>)}
          </ul>
        </ScrollArea>
        {summary && <p role="status" className="text-sm text-muted-foreground">
          已处理 {summary.done} 项{summary.unchanged ? `，${summary.unchanged} 项无需改动` : ''}
          {summary.conflicts ? `，${summary.conflicts} 项冲突未处理` : ''}{summary.failed ? `，${summary.failed} 项失败` : ''}。对话和记忆保持不变。
        </p>}
      </>}

      {failure && <p role="alert" className="rounded-md bg-state-failed-soft px-3 py-2 text-sm text-state-failed">
        {failure.lease ? <LeaseConflict lease={failure.lease}/> : failure.message}
      </p>}

      <DialogFooter>
        <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{results ? '完成' : '取消'}</Button>
        {changes && !blocked && !results && entries.length > 0 && !nothing && (
          <Button disabled={submitting || items.length === 0} onClick={() => void submit(items)}>
            {submitting ? (undoing ? '正在撤回' : '正在撤销') : `${undoing ? '撤回' : '撤销'}所选${items.length ? `（${items.length}）` : ''}`}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
