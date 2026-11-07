import {useEffect, useState, useSyncExternalStore} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {operationApi} from '@/lib/api/workspace'
import {clearDraft, sessionDraftScope, workspaceDraftScope} from '@/lib/drafts'
import {
  deletionProgress, forgetDeletion, pendingDeletions, subscribeDeletions, type DeletionProgress, type PendingDeletion,
} from '@/lib/workspace-deletions'
import {useWorkspaces} from '@/providers/workspaces-provider'

const POLL_MS = 1500

function DeletionRow({item}: {item: PendingDeletion}) {
  const {refresh} = useWorkspaces()
  const [progress, setProgress] = useState<DeletionProgress | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (progress && progress.state !== 'running') return
    let alive = true
    const read = async () => {
      try {
        const operation = await operationApi.get(item.operationId)
        if (!alive) return
        const next = deletionProgress(operation)
        setReadError(null)
        if (next.state === 'completed') {
          clearDraft(workspaceDraftScope(item.workspaceId))
          for (const id of item.sessionIds) clearDraft(sessionDraftScope(id))
          forgetDeletion(item.operationId)
          toast.success(`已删除工作区「${item.name}」，文件夹与其中的文件保持原样`)
          void refresh()
          return
        }
        setProgress(next)
      } catch (error) {
        if (alive) setReadError(error instanceof Error ? error.message : '读取清理进度失败')
      }
    }
    void read()
    const timer = window.setInterval(() => {if (document.visibilityState !== 'hidden') void read()}, POLL_MS)
    return () => {alive = false; window.clearInterval(timer)}
  }, [item, progress, refresh])

  const retry = async () => {
    setRetrying(true)
    try {
      await operationApi.retry(item.operationId)
      setProgress(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试失败')
    } finally {setRetrying(false)}
  }

  const failed = progress?.state === 'failed'
  const detail = progress?.total ? `${progress.phase}（${progress.completed}/${progress.total}）` : progress?.phase || '正在准备清理'
  return <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-state-waiting-soft px-5 py-2 text-sm">
    <span className="min-w-0 flex-1">
      {failed
        ? <>删除「{item.name}」未完成：{progress?.error ?? '清理失败'}</>
        : <>正在删除工作区「{item.name}」：{readError ?? detail}。文件夹与其中的文件不会被删除。</>}
    </span>
    {failed && progress?.canRetry && <Button variant="ghost" size="sm" disabled={retrying} onClick={() => void retry()}>重试清理</Button>}
    {failed && <Button variant="ghost" size="sm" onClick={() => forgetDeletion(item.operationId)}>关闭</Button>}
  </div>
}

/** 工作区删除受理后立即退出列表，清理在后台继续：进度条贴在主区顶部，不随页面切换消失。 */
export function WorkspaceDeletionNotice() {
  const items = useSyncExternalStore(subscribeDeletions, pendingDeletions)
  if (!items.length) return null
  return <>{items.map(item => <DeletionRow key={item.operationId} item={item}/>)}</>
}
