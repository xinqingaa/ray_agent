import {useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {workspaceApi} from '@/lib/api/workspace'
import type {WorkspaceItem} from '@/lib/api/types'
import {trackDeletion} from '@/lib/workspace-deletions'
import {useWorkspaces} from '@/providers/workspaces-provider'

/** 删除只移除工作区及其对话、任务记录与副本；用户的文件夹和文件原样保留。 */
export function DeleteWorkspaceDialog({workspace, sessionIds, open, onOpenChange, onAccepted}: {
  workspace: WorkspaceItem
  sessionIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAccepted: () => void
}) {
  const {drop} = useWorkspaces()
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      const operation = await workspaceApi.remove(workspace.id)
      trackDeletion({operationId: operation.operation_id, workspaceId: workspace.id, name: workspace.name, sessionIds})
      drop(workspace.id)
      onOpenChange(false)
      onAccepted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败，请重试')
    } finally {setBusy(false)}
  }
  return <Dialog open={open} onOpenChange={value => {if (!busy) onOpenChange(value)}}>
    <DialogContent className="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>删除工作区「{workspace.name}」？</DialogTitle>
        <DialogDescription>
          将删除这个工作区里的全部对话及其附件、运行记录。
        </DialogDescription>
      </DialogHeader>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>绑定的文件夹和其中的文件不会被删除，也不会被改动。</li>
        <li>清理在后台进行，期间可以继续使用其他对话；进度显示在窗口顶部，失败时可重试。</li>
      </ul>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? '正在提交' : '删除工作区'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
