import {useCallback, useEffect, useState} from 'react'
import {Undo2, FileSearch} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {historyApi} from '@/lib/api/workspace'
import type {RunChanges, ShellChanges, WorkspaceItem} from '@/lib/api/types'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog'
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
  const [shell, setShell] = useState<ShellChanges | null>(null)
  const [shellOpen, setShellOpen] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [shellError, setShellError] = useState<string | null>(null)
  const signal = live.change.signal
  const onOpenChange = useCallback((next: boolean) => setOpen(next), [])
  const leaseId = live.lease?.id ?? null

  useEffect(() => {
    let cancelled = false
    historyApi.shellChanges(workspaceId, runId)
      .then(next => {if (!cancelled) {setShell(next); setShellError(null)}})
      .catch(() => {if (!cancelled) setShell(null)})
    return () => {cancelled = true}
  }, [workspaceId, runId, signal, leaseId])

  const loadMore = async () => {
    if (!shell || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await historyApi.shellChanges(workspaceId, runId, shell.entries.length)
      setShell({...next, entries: [...shell.entries, ...next.entries]})
      setShellError(null)
    } catch (error) {setShellError(error instanceof Error ? error.message : '读取失败')}
    finally {setLoadingMore(false)}
  }

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
    {shell && shell.state !== 'not_started' && <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3.5 py-2.5">
      <p className="min-w-0 flex-1 text-sm">{shell.state === 'complete' ? `脚本执行区间观察到 ${shell.total} 个文件变化。` : shell.state === 'unknown' ? '脚本执行后的文件状态未能确认。' : '正在观察脚本执行区间的文件变化。'}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => setShellOpen(true)}><FileSearch aria-hidden/>查看文件变化</Button>
    </div>}
    <Dialog open={shellOpen} onOpenChange={setShellOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>脚本执行区间的文件变化</DialogTitle>
          <DialogDescription>按文件大小和修改时间比较执行前后，可能包含同时发生的外部修改，无法确定写入者。未保存内容备份，这些记录不支持撤销。</DialogDescription>
        </DialogHeader>
        {shell?.roots.some(root => root.partial) && <p className="text-sm text-muted-foreground">扫描范围不完整，列表只包含已观察到的变化；无法分类的条目不代表新增或删除。</p>}
        {shell?.state === 'unknown' && <p className="text-sm">进程结束未确认或执行被中断，没有可确认的执行后清单。</p>}
        {shell?.state === 'observing' && <p className="text-sm">执行尚未完成，确认进程子树结束后生成摘要。</p>}
        {shell?.roots.flatMap(root => root.errors).map((error, i) => <p key={i} className="break-words text-sm text-destructive">{error}</p>)}
        <ul className="divide-y text-sm">
          {shell?.entries.map(entry => <li key={`${entry.root_id}:${entry.relative_path}`} className="space-y-1 py-2">
            <div className="flex gap-2"><span className="shrink-0 text-muted-foreground">{{create: '新增', modify: '变化', delete: '删除', unclassified: '未分类'}[entry.operation]}</span><span className="break-all font-mono">{entry.relative_path}</span></div>
            <p className="text-xs text-muted-foreground">{shell.roots.find(root => root.root_id === entry.root_id)?.kind === 'workspace_folder' ? '工作区文件夹' : '会话工作目录'}</p>
          </li>)}
        </ul>
        {shell?.state === 'complete' && shell.total === 0 && <p className="text-sm text-muted-foreground">扫描范围内未观察到元数据差异。</p>}
        {shellError && <p role="alert" className="text-sm text-destructive">{shellError}</p>}
        {shell?.has_more && <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在读取…' : '加载更多'}</Button>}
      </DialogContent>
    </Dialog>
    {available && <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-3.5 py-2.5">
      <p className="min-w-0 flex-1 text-sm">本次运行修改了文件夹里的 {count} 个文件。</p>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden/>撤销本次修改
      </Button>
    </div>}
    <UndoRunDialog workspaceId={workspaceId} runId={runId} open={open} onOpenChange={onOpenChange} onChanged={live.requestRefresh}/>
  </>
}
