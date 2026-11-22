import {Link} from '@/lib/navigation'
import {useCallback, useState} from 'react'
import {Pencil, Undo2} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {cn, formatRelativeDate, formatSidebarTime} from '@/lib/utils'
import {runStillActive} from '@/lib/workspace-changes'
import type {ModifiedRun} from '@/lib/api/types'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {UndoRunDialog} from './undo-dialog'

/** 最近修改过这个文件夹的运行（按时间倒序），每项可进入撤销；运行进行中的只显示状态。 */
export function RecentChanges({workspaceId, runs}: {workspaceId: string; runs: ModifiedRun[]}) {
  const live = useWorkspaceLive()
  const [target, setTarget] = useState<ModifiedRun | null>(null)
  const onOpenChange = useCallback((open: boolean) => {if (!open) setTarget(null)}, [])
  return <>
    <ul aria-label="最近修改过文件夹的运行">
      {runs.map(run => {
        const undoing = run.kind === 'undo'
        const manual = run.kind === 'manual'
        const active = !undoing && !manual && runStillActive(run.run_status)
        const Icon = undoing ? Undo2 : Pencil
        const title = undoing ? `撤销了「${run.session_title || '未命名对话'}」的修改` : manual ? '文件和文件夹操作' : run.session_title || '未命名对话'
        const titleClass = 'block truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring'
        return <li key={run.run_id} className="flex items-center gap-2.5 rounded-[10px] px-2 py-2 hover:bg-muted/60">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
          <div className="min-w-0 flex-1">
            {/* 文件操作不属于某个对话，不提供对话链接 */}
            {manual
              ? <p className={cn(titleClass)} title={title}>{title}</p>
              : <Link href={workspaceSessionHref(workspaceId, run.session_id)} className={cn(titleClass, 'hover:underline')} title={run.session_title || undefined}>{title}</Link>}
            <p className="mt-0.5 text-xs text-faint">
              {manual ? '涉及' : undoing ? '涉及' : '修改'} {run.changed_files} {manual ? '项' : '个文件'} · <span className="tabular-nums" title={formatRelativeDate(String(run.last_at))}>{formatSidebarTime(run.last_at)}</span>{active ? ' · 运行中' : ''}
            </p>
          </div>
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={active} title={active ? '运行结束后才能撤销' : undefined}
            onClick={() => setTarget(run)}>{undoing ? '撤回' : '撤销'}</Button>
        </li>
      })}
    </ul>
    <UndoRunDialog workspaceId={workspaceId} runId={target?.run_id ?? null} kind={target?.kind} open={target != null} onOpenChange={onOpenChange} onChanged={live.requestRefresh}/>
  </>
}
