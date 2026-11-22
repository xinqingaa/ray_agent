import {DangerConfirmDialog} from '@/components/ui/danger-confirm-dialog'
import {workspaceApi} from '@/lib/api/workspace'
import {sessionApi} from '@/lib/api/session'
import type {WorkspaceItem} from '@/lib/api/types'
import {trackDeletion} from '@/lib/workspace-deletions'
import {useWorkspaces} from '@/providers/workspaces-provider'

async function knownSessionIds(workspaceId: string, cached: string[]) {
  const ids = new Set(cached)
  try {
    for (let offset = 0; ;) {
      const page = await sessionApi.getSessions(offset, {workspaceId})
      for (const session of page.sessions) ids.add(session.session_id)
      offset += page.sessions.length
      if (!page.sessions.length || offset >= page.total) break
    }
  } catch {/* 保留已取得的会话身份，删除受理由核心决定。 */}
  return [...ids]
}

/**
 * 删除只移除工作区及其对话、任务记录与副本；用户的文件夹和文件原样保留。
 * 提交失败时说明留在弹框内（危险确认的统一行为）。
 */
export function DeleteWorkspaceDialog({workspace, sessionIds, open, onOpenChange, onAccepted, onRestoreFocus}: {
  workspace: WorkspaceItem
  sessionIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAccepted: () => void
  onRestoreFocus?: () => void
}) {
  const {drop} = useWorkspaces()
  const confirm = async () => {
    const affectedSessions = await knownSessionIds(workspace.id, sessionIds)
    const operation = await workspaceApi.remove(workspace.id)
    trackDeletion({operationId: operation.operation_id, workspaceId: workspace.id, name: workspace.name, sessionIds: affectedSessions})
    drop(workspace.id)
    onAccepted()
  }
  return <DangerConfirmDialog
    open={open}
    onOpenChange={onOpenChange}
    title={`删除工作区「${workspace.name}」？`}
    description="将删除这个工作区里的全部对话及其附件、运行记录。"
    confirmLabel="删除工作区"
    busyLabel="正在提交"
    onConfirm={confirm}
    onRestoreFocus={onRestoreFocus}
  >
    <ul className="list-disc space-y-1 pl-5 text-sm">
      <li>绑定的文件夹和其中的文件不会被删除，也不会被改动。</li>
      <li>清理在后台进行，期间可以继续使用其他对话；进度显示在窗口顶部，失败时可重试。</li>
    </ul>
  </DangerConfirmDialog>
}
