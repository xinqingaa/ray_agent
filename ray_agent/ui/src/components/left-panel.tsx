import {useEffect, useState} from 'react'
import {Link, useRouter, usePathname} from '@/lib/navigation'
import {toast} from 'sonner'
import {Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {ChevronLeft, Settings} from 'lucide-react'
import {NewChatIcon} from '@/components/nav-icons'
import {SettingsDialog} from '@/components/settings/settings-dialog'
import {SidebarChrome} from '@/components/sidebar-chrome'
import {SessionItem} from '@/components/session-item'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {useSessions} from '@/hooks/use-sessions'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api/types'
import {parseWorkspaceRoute, workspaceHref, workspaceSessionHref} from '@/lib/workspace-route'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspace} from '@/providers/workspaces-provider'
import {WorkspaceStatus} from '@/components/workspace/workspace-status'

export function LeftPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile} = useSidebar()
  const {sessions, loading, error, refresh, deleteSession, patchSession, liveSession} = useSessions()
  const [selectedRecord, setSelected] = useState<Session | null>(null)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [pendingRename, setPendingRename] = useState<Session | null>(null)
  const route = parseWorkspaceRoute(pathname)
  const workspaceId = route.workspaceId
  const lookup = useWorkspace(workspaceId)
  const workspace = lookup.phase === 'ready' ? lookup.workspace : null
  const state = workspace ? describeWorkspace(workspace) : null
  const canStartChat = !state || (!state.archived && !state.deleting)
  const sessionId = workspaceId ? route.sessionId : pathname.startsWith('/sessions/') ? pathname.split('/')[2] : null
  const home = workspaceId ? workspaceHref(workspaceId) : '/'
  const hrefFor = (id: string) => workspaceId ? workspaceSessionHref(workspaceId, id) : `/sessions/${id}`
  const selected = selectedRecord?.session_id === sessionId ? selectedRecord : null

  // 当前会话不在已加载的分页里时单独读取，保证导航里能定位到它
  useEffect(() => {
    if (!sessionId) return
    let active = true
    sessionApi.getSession(sessionId).then(session => {if (active) setSelected(session)})
      .catch(() => {if (active) setSelected(null)})
    return () => {active = false}
  }, [sessionId])

  const newChat = () => {setOpenMobile(false); router.push(home)}
  const remove = async () => {
    if (!pendingDelete) return
    const success = await deleteSession(pendingDelete.session_id)
    if (success) {if (sessionId === pendingDelete.session_id) router.push(home); await refresh()}
    else toast.error('删除对话失败，请重试')
    setPendingDelete(null)
  }
  const conversations = [...sessions]
  if (selected && (selected.workspace_id ?? null) === workspaceId && !conversations.some(item => item.session_id === selected.session_id)) {
    conversations.push(liveSession?.id === selected.session_id ? {...selected, status: liveSession.status} : selected)
  }

  return <>
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 pb-1 pt-2 group-data-[collapsible=icon]:px-2"><SidebarChrome/></SidebarHeader>
      <SidebarContent className="min-h-0 overflow-hidden px-3 pb-2 pt-1 group-data-[collapsible=icon]:px-2">
        <div className="hidden flex-1 flex-col items-center gap-2 group-data-[collapsible=icon]:flex">
          {canStartChat && <Button variant="ghost" size="icon-sm" className="group/create text-muted-foreground" aria-label="新对话" title="新对话" onClick={newChat}><NewChatIcon className="size-[18px]" aria-hidden="true"/></Button>}
        </div>
        <nav aria-label={workspaceId ? '工作区对话' : '对话'} className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
          {workspaceId && <div className="mb-3 shrink-0 space-y-1">
            <Link href="/" onClick={() => setOpenMobile(false)} className="inline-flex items-center gap-0.5 rounded-sm pl-1 text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronLeft className="size-4" aria-hidden/>全部工作区
            </Link>
            <Link href={home} onClick={() => setOpenMobile(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{workspace?.name ?? '工作区'}</span>
              {workspace && <WorkspaceStatus workspace={workspace}/>}
            </Link>
          </div>}
          <div className="mb-2 flex shrink-0 items-center justify-between gap-3 pl-2">
            <h2 className="text-meta font-medium text-muted-foreground">对话</h2>
            {canStartChat && <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="group/create text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="新建对话" onClick={newChat}>
                <NewChatIcon className="size-[18px]" aria-hidden="true"/>
              </Button></TooltipTrigger>
              <TooltipContent side="bottom">新建对话</TooltipContent>
            </Tooltip>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
            {loading && !conversations.length && <p className="px-2 py-3 text-meta text-faint">正在读取对话</p>}
            {error && <div className="px-2 py-3"><p role="alert" className="text-meta text-state-failed">{error}</p><Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button></div>}
            {!loading && !error && !conversations.length && <p className="px-2 py-3 text-meta text-faint">还没有对话</p>}
            {conversations.map(session => <SessionItem key={session.session_id} session={session} isActive={sessionId === session.session_id}
              href={hrefFor(session.session_id)} onClick={() => setOpenMobile(false)}
              onDelete={setPendingDelete} onRename={setPendingRename}/>)}
          </div>
        </nav>
      </SidebarContent>
      <SidebarFooter><Button variant="ghost" className="w-full justify-start gap-2.5 text-muted-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0" onClick={() => {setOpenMobile(false); setAppSettingsOpen(true)}} title="设置" aria-label="设置"><Settings className="size-[18px]" aria-hidden="true"/><span className="group-data-[collapsible=icon]:hidden">设置</span></Button></SidebarFooter>
    </Sidebar>
    <SettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen}/>
    <DeleteSessionDialog open={!!pendingDelete} onOpenChange={open => {if (!open) setPendingDelete(null)}} onConfirm={remove}/>
    {pendingRename && <RenameSessionDialog sessionId={pendingRename.session_id} currentTitle={pendingRename.title} open onOpenChange={open => {if (!open) setPendingRename(null)}} onSaved={title => {
      const id = pendingRename.session_id
      patchSession(id, {title})
      setSelected(current => current?.session_id === id ? {...current, title} : current)
      void refresh()
    }}/>}
  </>
}
