import {useEffect, useState, type ReactNode} from 'react'
import {Link, useRouter, usePathname} from '@/lib/navigation'
import {toast} from 'sonner'
import {Sidebar, SidebarContent, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {Folder, FolderOpen, Plus} from '@/components/ui/icons'
import {SessionItem} from '@/components/session-item'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {WorkspaceAddAction} from '@/components/workspace/workspace-list'
import {useSessions} from '@/hooks/use-sessions'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api/types'
import {parseWorkspaceRoute, workspaceHref, workspaceSessionHref} from '@/lib/workspace-route'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {WorkspaceStatus} from '@/components/workspace/workspace-status'
import {formatDayLabel} from '@/lib/utils'

type SessionRows = {sessions: Session[]; loading: boolean; error: string | null}

const EMPTY_ROWS: SessionRows = {sessions: [], loading: true, error: null}

function DirectoryStatus({loading, error, empty, onRetry}: {loading: boolean; error: string | null; empty: string | null; onRetry: () => void}) {
  if (error) return <div className="px-2 py-3"><p role="alert" className="text-meta text-state-failed">{error}</p>
    <Button size="xs" variant="ghost" onClick={onRetry}>重试</Button></div>
  if (loading) return <p role="status" className="px-2 py-3 text-meta text-faint">正在读取…</p>
  return empty ? <p className="px-2 py-3 text-meta text-faint">{empty}</p> : null
}

function DirectoryFrame({label, action, children}: {label: string; action: ReactNode; children: ReactNode}) {
  return <Sidebar inline className="bg-canvas">
    <SidebarHeader className="flex h-14 shrink-0 flex-row items-center justify-between px-5 pt-3 pb-0">
      <h2 className="text-base font-semibold tracking-tight">{label}</h2>{action}
    </SidebarHeader>
    <SidebarContent className="min-h-0 gap-0 overflow-y-auto px-3 pb-4">
      <nav aria-label={label} className="min-w-0">{children}</nav>
    </SidebarContent>
  </Sidebar>
}

/** 非当前工作区只取目录快照，当前工作区复用唯一实时会话列表。 */
function ExpandedWorkspaceSessions({id, revision, renderRows}: {id: string; revision: number; renderRows: (rows: Session[]) => ReactNode}) {
  const [snapshot, setSnapshot] = useState<SessionRows>(EMPTY_ROWS)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setSnapshot(previous => ({...previous, loading: true, error: null}))
      try {
        const page = await sessionApi.getSessions(0, {workspaceId: id})
        if (!cancelled) setSnapshot({sessions: page.sessions, loading: false, error: null})
      } catch (reason) {
        if (!cancelled) setSnapshot({sessions: [], loading: false, error: reason instanceof Error ? reason.message : '读取对话失败'})
      }
    }
    void load()
    return () => {cancelled = true}
  }, [id, revision, retry])
  return <>
    {!snapshot.sessions.length && <DirectoryStatus loading={snapshot.loading} error={snapshot.error} empty="还没有对话" onRetry={() => setRetry(value => value + 1)}/>}
    {renderRows(snapshot.sessions)}
  </>
}

export function LeftPanel({scope, expanded, onExpand}: {
  scope: 'independent' | 'workspaces'; expanded: Record<string, boolean>; onExpand: (id: string, open: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile} = useSidebar()
  const {sessions, loading, error, refresh, deleteSession, patchSession, liveSession} = useSessions()
  const {workspaces, loading: workspacesLoading, error: workspacesError, refresh: refreshWorkspaces} = useWorkspaces()
  const [selectedRecord, setSelected] = useState<Session | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [pendingRename, setPendingRename] = useState<Session | null>(null)
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  const {workspaceId, sessionId: workspaceSessionId} = parseWorkspaceRoute(pathname)
  const sessionId = workspaceSessionId ?? pathname.match(/^\/sessions\/([^/]+)/)?.[1]
  const selected = selectedRecord?.session_id === sessionId ? selectedRecord : null

  // 深链接可能定位到分页以外的旧会话。
  useEffect(() => {
    if (!sessionId) return
    let active = true
    sessionApi.getSession(sessionId).then(session => {if (active) setSelected(session)})
      .catch(() => {if (active) setSelected(null)})
    return () => {active = false}
  }, [sessionId])

  const currentRows = selected && (selected.workspace_id ?? null) === workspaceId &&
    !sessions.some(item => item.session_id === selected.session_id)
    ? [...sessions, liveSession?.id === selected.session_id ? {...selected, status: liveSession.status} : selected]
    : sessions
  const hrefFor = (id: string, owner: string | null) => owner ? workspaceSessionHref(owner, id) : `/sessions/${encodeURIComponent(id)}`
  const renderRows = (rows: Session[], owner: string | null) => rows.map(session => <SessionItem key={session.session_id}
    session={session} href={hrefFor(session.session_id, owner)} isActive={sessionId === session.session_id}
    onClick={() => setOpenMobile(false)} onDelete={setPendingDelete} onRename={setPendingRename}/>)
  const invalidate = (owner: string | null) => {
    if (owner === workspaceId) void refresh()
    else if (owner) setRevisions(current => ({...current, [owner]: (current[owner] ?? 0) + 1}))
  }
  const remove = async () => {
    if (!pendingDelete) return
    const owner = pendingDelete.workspace_id ?? null
    if (owner === workspaceId) {
      if (!await deleteSession(pendingDelete.session_id)) {toast.error('删除对话失败，请重试'); return}
    } else {
      try {await sessionApi.deleteSession(pendingDelete.session_id)}
      catch (reason) {toast.error(reason instanceof Error ? reason.message : '删除对话失败'); return}
    }
    if (sessionId === pendingDelete.session_id) router.push(owner ? workspaceHref(owner) : '/')
    invalidate(owner)
    setPendingDelete(null)
  }

  return <>
    {scope === 'workspaces' ? <DirectoryFrame label="工作区" action={<WorkspaceAddAction/>}>
      <DirectoryStatus loading={workspacesLoading && !workspaces.length} error={workspacesError}
        empty={!workspaces.length ? '还没有工作区' : null} onRetry={() => void refreshWorkspaces()}/>
      {workspaces.length > 0 && <p className="px-2 pt-3 pb-1 text-xs text-faint">本机</p>}
      {workspaces.map(workspace => {
        const active = workspace.id === workspaceId
        const home = workspaceHref(workspace.id)
        const open = expanded[workspace.id] ?? active
        const Glyph = open ? FolderOpen : Folder
        return <div key={workspace.id} className="my-0.5">
          <Link href={home} className="workspace-directory-row" aria-expanded={open} aria-current={pathname === home ? 'page' : undefined}
            onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
              if (pathname === home) {
                event.preventDefault()
                onExpand(workspace.id, !open)
              } else {
                onExpand(workspace.id, true)
                setOpenMobile(false)
              }
            }}><Glyph className="size-[18px] shrink-0 text-muted-foreground"/>
            <span className="min-w-0 flex-1 truncate" dir="auto">{workspace.name}</span>
            <WorkspaceStatus workspace={workspace} compact/>
          </Link>
          {open && <div className="workspace-directory-children" aria-label={`${workspace.name}的对话`}>
            {active ? <>
              {!currentRows.length && <DirectoryStatus loading={loading} error={error} empty="还没有对话" onRetry={() => void refresh()}/>}
              {renderRows(currentRows, workspace.id)}
            </> : <ExpandedWorkspaceSessions id={workspace.id} revision={revisions[workspace.id] ?? 0} renderRows={rows => renderRows(rows, workspace.id)}/>}
          </div>}
        </div>
      })}
    </DirectoryFrame> : <DirectoryFrame label="独立对话" action={<IconAction label="新对话" asChild>
      <Link href="/" onClick={() => setOpenMobile(false)}><Plus/></Link>
    </IconAction>}>
      <DirectoryStatus loading={loading && !currentRows.length} error={error} empty={!currentRows.length ? '还没有独立对话' : null}
        onRetry={() => void refresh()}/>
      {['今天', '昨天', '更早'].map(label => {
        const rows = currentRows.filter(session => {
          const day = formatDayLabel(session.latest_message_at)
          return label === '更早' ? day !== '今天' && day !== '昨天' : day === label
        })
        return rows.length > 0 && <div key={label} className="mb-2">
          <p className="px-2 pt-3 pb-1 text-xs text-faint">{label}</p>
          {renderRows(rows, null)}
        </div>
      })}
    </DirectoryFrame>}
    <DeleteSessionDialog open={!!pendingDelete} onOpenChange={open => {if (!open) setPendingDelete(null)}} onConfirm={remove}/>
    {pendingRename && <RenameSessionDialog sessionId={pendingRename.session_id} currentTitle={pendingRename.title} open
      onOpenChange={open => {if (!open) setPendingRename(null)}} onSaved={title => {
        const id = pendingRename.session_id
        const owner = pendingRename.workspace_id ?? null
        if (owner === workspaceId) patchSession(id, {title})
        setSelected(current => current?.session_id === id ? {...current, title} : current)
        invalidate(owner)
      }}/>}
  </>
}
