import {useRef, useState, type ReactElement, type Ref} from 'react'
import {toast} from 'sonner'
import {ContextMenuSurface, menuItem, type MenuEntry} from '@/components/ui/context-menu'
import {Archive, ArchiveRestore, ArrowUpRight, Copy, Finder, Pencil, Terminal, Trash} from '@/components/ui/icons'
import {copyText} from '@/lib/clipboard'
import {useSessions} from '@/hooks/use-sessions'
import type {WorkspaceItem} from '@/lib/api/types'
import {usePathname, useRouter} from '@/lib/navigation'
import {fileManagerName, isDesktop, revealInFileManager} from '@/lib/platform'
import {toggleWorkspaceArchive, toggleWorkspaceExecution} from '@/lib/workspace-mutation'
import {workspaceHref, parseWorkspaceRoute} from '@/lib/workspace-route'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {DeleteWorkspaceDialog} from './delete-workspace-dialog'
import {RenameWorkspaceDialog} from './rename-workspace-dialog'

/** 工作区行的菜单项定义；右键菜单与行的“更多”菜单共用。没有对应动作的项不出现。 */
export function workspaceMenuEntries(workspace: WorkspaceItem, actions: {
  canReveal: boolean
  busy?: boolean
  onOpen?: () => void
  onReveal: () => void
  onCopyPath?: () => void
  onToggleExecution?: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}): MenuEntry[] {
  const {archived, deleting} = describeWorkspace(workspace)
  const path = workspace.folder?.path
  return [
    ...(actions.onOpen ? [menuItem('打开', ArrowUpRight, actions.onOpen)] : []),
    ...(actions.canReveal ? [menuItem(`在 ${fileManagerName()} 中显示`, Finder, actions.onReveal)] : []),
    ...(path && actions.onCopyPath ? [menuItem('复制路径', Copy, actions.onCopyPath)] : []),
    ...(actions.onToggleExecution && !archived && !deleting ? [menuItem(workspace.local_execution_enabled === true ? '关闭本机执行' : '启用本机执行', Terminal, actions.onToggleExecution)] : []),
    menuItem('重命名工作区', Pencil, actions.onRename),
    ...(!actions.busy ? [menuItem(archived ? '取消归档' : '归档工作区', archived ? ArchiveRestore : Archive, actions.onArchive)] : []),
    {type: 'separator'},
    menuItem('删除工作区…', Trash, actions.onDelete, {destructive: true}),
  ]
}

export function WorkspaceRowActions({workspace, children, triggerRef, canReveal, busy, onOpen, onReveal, onCopyPath, onToggleExecution, onRename, onArchive, onDelete}: {
  workspace: WorkspaceItem
  children: ReactElement
  triggerRef?: Ref<HTMLElement>
  canReveal: boolean
  busy?: boolean
  onOpen?: () => void
  onReveal: () => void
  onCopyPath?: () => void
  onToggleExecution?: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const {deleting} = describeWorkspace(workspace)
  const entries = workspaceMenuEntries(workspace, {canReveal, busy, onOpen, onReveal, onCopyPath, onToggleExecution, onRename, onArchive, onDelete})
  return <ContextMenuSurface ref={triggerRef} disabled={deleting} items={entries}>{children}</ContextMenuSurface>
}

export function WorkspaceRowMenu({workspace, children}: {workspace: WorkspaceItem; children: ReactElement}) {
  const router = useRouter()
  const activeWorkspace = parseWorkspaceRoute(usePathname()).workspaceId
  const {directories} = useSessions()
  const {upsert, refresh} = useWorkspaces()
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const row = useRef<HTMLElement>(null)
  const condition = describeWorkspace(workspace)
  const rootId = workspace.folder?.root_id
  const canReveal = isDesktop() && condition.folderAvailable && !!rootId
  const restoreFocus = () => row.current?.focus({preventScroll: true})
  const executionOn = workspace.local_execution_enabled === true
  const toggleExecution = async () => {
    if (busy) return
    setBusy(true)
    try {await toggleWorkspaceExecution(workspace, !executionOn, upsert, () => void refresh())}
    finally {setBusy(false)}
  }
  const reveal = async () => {
    if (!canReveal || !rootId) return
    try {await revealInFileManager(rootId, '')}
    catch (error) {toast.error(error instanceof Error ? error.message : '无法显示位置')}
  }
  const archive = async () => {
    if (busy) return
    setBusy(true)
    try {await toggleWorkspaceArchive(workspace, upsert, () => void refresh())}
    finally {setBusy(false)}
  }
  return <>
    <WorkspaceRowActions workspace={workspace} triggerRef={row} canReveal={canReveal} busy={busy}
      onOpen={() => router.push(workspaceHref(workspace.id))} onReveal={() => void reveal()}
      onCopyPath={() => workspace.folder && copyText(workspace.folder.path)} onToggleExecution={() => void toggleExecution()}
      onRename={() => setDialog('rename')} onArchive={() => void archive()} onDelete={() => setDialog('delete')}>{children}</WorkspaceRowActions>
    <RenameWorkspaceDialog workspace={workspace} open={dialog === 'rename'} onOpenChange={open => {if (!open) setDialog(null)}}
      onRestoreFocus={restoreFocus}/>
    <DeleteWorkspaceDialog workspace={workspace} sessionIds={directories[workspace.id]?.sessions.map(session => session.session_id) ?? []}
      open={dialog === 'delete'} onOpenChange={open => {if (!open) setDialog(null)}} onRestoreFocus={restoreFocus}
      onAccepted={() => {if (activeWorkspace === workspace.id) router.push('/workspaces')}}/>
  </>
}
