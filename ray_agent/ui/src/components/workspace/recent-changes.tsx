import {Link} from '@/lib/navigation'
import {useCallback, useState} from 'react'
import {Undo2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {formatRelativeDate} from '@/lib/utils'
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
    <ul className="divide-y rounded-md border" aria-label="最近修改过文件夹的运行">
      {runs.map(run => {
        const undoing = run.kind === 'undo'
        const active = !undoing && runStillActive(run.run_status)
        return <li key={run.run_id} className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Link href={workspaceSessionHref(workspaceId, run.session_id)} className="block truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={run.session_title || undefined}>
              {undoing ? `撤销了「${run.session_title || '未命名对话'}」的修改` : run.session_title || '未命名对话'}
            </Link>
            <p className="text-xs text-muted-foreground">
              {undoing ? '涉及' : '修改了'} {run.changed_files} 个文件 · {formatRelativeDate(String(run.last_at))}{active ? ' · 运行中' : ''}
            </p>
          </div>
          <Button type="button" variant="outline" size="xs" disabled={active} title={active ? '运行结束后才能撤销' : undefined}
            onClick={() => setTarget(run)}><Undo2 aria-hidden/>{undoing ? '撤回' : '撤销'}</Button>
        </li>
      })}
    </ul>
    <UndoRunDialog workspaceId={workspaceId} runId={target?.run_id ?? null} kind={target?.kind} open={target != null} onOpenChange={onOpenChange} onChanged={live.requestRefresh}/>
  </>
}
