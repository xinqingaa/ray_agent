import {useCallback, useEffect, useState} from 'react'
import {Undo2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {historyApi} from '@/lib/api/workspace'
import type {RunChanges, WorkspaceItem} from '@/lib/api/types'
import {undoAvailable} from '@/lib/workspace-changes'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {UndoRunDialog} from './undo-dialog'

/**
 * 运行结束条：这次运行在文件夹里留下了可撤销的修改时，给出“撤销本次修改”。
 * 运行进行中、工作区已归档或文件夹不可用、没有净变化时都不显示；读取失败不打扰对话。
 */
export function RunChangesBar({workspace, runId}: {workspace: WorkspaceItem; runId: string}) {
  // 写入权限或目标变化时卸载整段状态；入口消失则只隐藏提示条，保留已打开窗口的结果。
  return describeWorkspace(workspace).writable
    ? <WritableRunChangesBar key={`${workspace.id}:${runId}`} workspaceId={workspace.id} runId={runId}/>
    : null
}

function WritableRunChangesBar({workspaceId, runId}: {workspaceId: string; runId: string}) {
  const live = useWorkspaceLive()
  const [changes, setChanges] = useState<RunChanges | null>(null)
  const [open, setOpen] = useState(false)
  const signal = live.change.signal
  const onOpenChange = useCallback((next: boolean) => setOpen(next), [])

  useEffect(() => {
    let cancelled = false
    historyApi.runChanges(workspaceId, runId)
      .then(next => {if (!cancelled) setChanges(next)})
      .catch(() => {if (!cancelled) setChanges(null)})
    return () => {cancelled = true}
  }, [workspaceId, runId, signal])

  const available = undoAvailable(changes)
  const count = changes?.entries.length ?? 0
  return <>
    {available && <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-3.5 py-2.5">
      <p className="min-w-0 flex-1 text-sm">本次运行修改了文件夹里的 {count} 个文件。</p>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden/>撤销本次修改
      </Button>
    </div>}
    <UndoRunDialog workspaceId={workspaceId} runId={runId} open={open} onOpenChange={onOpenChange} onChanged={live.requestRefresh}/>
  </>
}
