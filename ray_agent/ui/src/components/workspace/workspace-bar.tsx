import {useState} from 'react'
import {Archive, ArchiveRestore, MoreHorizontal, Pencil, ScrollText, Trash, Terminal} from '@/components/ui/icons'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {useRouter, Link} from '@/lib/navigation'
import {TopbarActions} from '@/components/sidebar-chrome'
import {workspaceBackgroundHref} from '@/lib/workspace-route'
import {workspaceApi} from '@/lib/api/workspace'
import type {WorkspaceItem} from '@/lib/api/types'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {describeWorkspace} from '@/lib/workspace-state'
import {useSessions} from '@/hooks/use-sessions'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {DeleteWorkspaceDialog} from './delete-workspace-dialog'
import {RenameWorkspaceDialog} from './rename-workspace-dialog'

/** 工作区页顶部的位置条：返回全部工作区、名称与状态、本机执行开关、重命名/归档/删除。 */
export function WorkspaceBar({workspace}: {workspace: WorkspaceItem}) {
  const router = useRouter()
  const {upsert, refresh} = useWorkspaces()
  const {sessions} = useSessions()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const condition = describeWorkspace(workspace)
  const executionOn = workspace.local_execution_enabled === true

  const toggleArchive = async () => {
    if (busy) return
    setBusy(true)
    try {
      upsert(condition.archived ? await workspaceApi.unarchive(workspace) : await workspaceApi.archive(workspace))
      toast.success(condition.archived ? '已取消归档' : '已归档，对话变为只读')
    } catch (error) {
      reportWorkspaceError(error, condition.archived ? '取消归档失败' : '归档失败', () => void refresh())
    } finally {setBusy(false)}
  }

  const toggleExecution = async (enabled: boolean) => {
    if (busy || condition.archived || condition.deleting) return
    setBusy(true)
    try {
      upsert(await workspaceApi.setLocalExecution(workspace, enabled))
      toast.success(enabled ? '已启用本机执行' : '已关闭本机执行')
    } catch (error) {
      reportWorkspaceError(error, '更新本机执行开关失败', () => void refresh())
    } finally {setBusy(false)}
  }

  return <>
    <TopbarActions>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="size-7 shrink-0 text-muted-foreground" aria-label="工作区操作" disabled={condition.deleting}>
          <MoreHorizontal className="size-4" aria-hidden/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href={workspaceBackgroundHref(workspace.id)}><ScrollText/>工作方式与记忆</Link></DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={executionOn} disabled={busy || condition.archived || condition.deleting}
          onCheckedChange={checked => void toggleExecution(checked)} title="启用后本工作区会话可使用 Shell 与脚本">
          <Terminal/>本机执行
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil aria-hidden/>重命名</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void toggleArchive()}>
          {condition.archived ? <ArchiveRestore aria-hidden/> : <Archive aria-hidden/>}{condition.archived ? '取消归档' : '归档'}
        </DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}><Trash aria-hidden/>删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </TopbarActions>
    <RenameWorkspaceDialog workspace={workspace} open={renaming} onOpenChange={setRenaming}/>
    <DeleteWorkspaceDialog workspace={workspace} sessionIds={sessions.map(session => session.session_id)} open={deleting} onOpenChange={setDeleting}
      onAccepted={() => router.push('/workspaces')}/>
  </>
}
