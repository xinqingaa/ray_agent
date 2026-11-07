import {useState} from 'react'
import {Archive, ArchiveRestore, ChevronLeft, MoreHorizontal, Pencil, Trash} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {useRouter, Link} from '@/lib/navigation'
import {workspaceApi} from '@/lib/api/workspace'
import type {WorkspaceItem} from '@/lib/api/types'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {describeWorkspace} from '@/lib/workspace-state'
import {useSessions} from '@/hooks/use-sessions'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {DeleteWorkspaceDialog} from './delete-workspace-dialog'
import {RenameWorkspaceDialog} from './rename-workspace-dialog'
import {WorkspaceStatus} from './workspace-status'

/** 工作区页顶部的位置条：返回全部工作区、名称与状态、重命名/归档/删除。 */
export function WorkspaceBar({workspace}: {workspace: WorkspaceItem}) {
  const router = useRouter()
  const {upsert, refresh} = useWorkspaces()
  const {sessions} = useSessions()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const condition = describeWorkspace(workspace)

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

  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
    <nav aria-label="位置" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
      <Link href="/" className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="size-4" aria-hidden/>工作区
      </Link>
      <span aria-hidden className="text-faint">/</span>
      <span className="min-w-0 truncate font-medium" dir="auto" title={workspace.folder?.path}>{workspace.name}</span>
      <WorkspaceStatus workspace={workspace} className="ml-2"/>
    </nav>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="size-7 shrink-0 text-muted-foreground" aria-label="工作区操作" disabled={condition.deleting}>
          <MoreHorizontal className="size-4" aria-hidden/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil aria-hidden/>重命名</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void toggleArchive()}>
          {condition.archived ? <ArchiveRestore aria-hidden/> : <Archive aria-hidden/>}{condition.archived ? '取消归档' : '归档'}
        </DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}><Trash aria-hidden/>删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <RenameWorkspaceDialog workspace={workspace} open={renaming} onOpenChange={setRenaming}/>
    <DeleteWorkspaceDialog workspace={workspace} sessionIds={sessions.map(session => session.session_id)} open={deleting} onOpenChange={setDeleting}
      onAccepted={() => router.push('/')}/>
  </div>
}
