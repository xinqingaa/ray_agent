import {useEffect, useState, type ReactNode} from 'react'
import {Link, useRouter, usePathname} from '@/lib/navigation'
import {Sidebar, SidebarContent, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {Folder, FolderOpen, Plus} from '@/components/ui/icons'
import {SessionItem} from '@/components/session-item'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {WorkspaceAddAction} from '@/components/workspace/workspace-list'
import {WorkspaceRowMenu} from '@/components/workspace/workspace-row-menu'
import {useSessions} from '@/hooks/use-sessions'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api/types'
import {parseWorkspaceRoute, workspaceHref, workspaceSessionHref} from '@/lib/workspace-route'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {WorkspaceStatus} from '@/components/workspace/workspace-status'
import {formatDayLabel} from '@/lib/utils'

const PAGE_SIZE = 50
type SessionRows = {sessions: Session[]; error: string | null}
type PendingSessionAction = {session: Session; restoreFocus: () => void}

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

/** 保留展开列表，首段实时数据与分页属于同一工作区。 */
function ExpandedWorkspaceSessions({id, open, active, revision, directory, selected, retryActive, renderRows}: {
  id: string; open: boolean; active: boolean; revision: number
  directory?: SessionRows & {loaded: boolean}
  selected: Session | null
  retryActive: () => Promise<void>
  renderRows: (rows: Session[]) => ReactNode
}) {
  const [snapshot, setSnapshot] = useState({
    first: [] as Session[], older: [] as Session[], offset: 0, total: 0, loaded: false,
    loading: false, error: null as string | null,
  })
  const [request, setRequest] = useState<{offset: number; end: number} | null>(null)
  const [seenRevision, setSeenRevision] = useState(revision)
  const hasDirectory = directory?.loaded === true
  if (seenRevision !== revision) {
    setSeenRevision(revision)
    setRequest({offset: 0, end: Math.max(PAGE_SIZE, snapshot.offset)})
  }

  useEffect(() => {
    if (!open || !request && (active || hasDirectory || snapshot.loaded)) return
    let cancelled = false
    const start = request?.offset ?? 0
    const end = request?.end ?? PAGE_SIZE
    setSnapshot(previous => ({...previous, loading: true, error: null}))
    async function load() {
      const fetched: Session[] = []
      let offset = start
      let total = start
      do {
        const page = await sessionApi.getSessions(offset, {workspaceId: id}, Math.min(PAGE_SIZE, end - offset))
        if (cancelled) return
        fetched.push(...page.sessions)
        offset += page.sessions.length
        total = page.sessions.length ? page.total : offset
      } while (offset < end && offset < total)
      setSnapshot(previous => {
        const first = start ? previous.first : fetched.slice(0, PAGE_SIZE)
        const older = start ? [...previous.older, ...fetched] : fetched.slice(PAGE_SIZE)
        return {first, older, loading: false, error: null, offset, total, loaded: true}
      })
      setRequest(null)
    }
    void load().catch(reason => {
      if (!cancelled) setSnapshot(previous => ({...previous, loading: false, error: reason instanceof Error ? reason.message : '读取对话失败'}))
    })
    return () => {cancelled = true}
  }, [active, hasDirectory, id, open, request, snapshot.loaded])

  const first = hasDirectory ? directory.sessions : snapshot.first
  const rows = new Map(first.map(session => [session.session_id, session]))
  for (const session of snapshot.older) if (!rows.has(session.session_id) && first.length >= PAGE_SIZE) rows.set(session.session_id, session)
  if (selected && !rows.has(selected.session_id)) rows.set(selected.session_id, selected)

  const error = snapshot.error ?? (active ? directory?.error ?? null : null)
  const loading = !hasDirectory && !snapshot.loaded && !error
  const nextOffset = Math.max(first.length, snapshot.offset)
  const more = first.length === PAGE_SIZE && (snapshot.offset >= PAGE_SIZE ? nextOffset < snapshot.total : hasDirectory)
  return <>
    {renderRows([...rows.values()])}
    {(!rows.size || error) && <DirectoryStatus loading={loading} error={error} empty={rows.size ? null : '还没有对话'}
      onRetry={() => snapshot.error ? setRequest(request ? {...request} : {offset: 0, end: PAGE_SIZE}) : void retryActive()}/>}
    {more && <Button variant="ghost" size="xs" className="ml-2" disabled={snapshot.loading && !!request}
      onClick={() => setRequest({offset: nextOffset, end: nextOffset + PAGE_SIZE})}>加载更多</Button>}
  </>
}

export function LeftPanel({scope, expanded, onExpand}: {
  scope: 'independent' | 'workspaces'; expanded: Record<string, boolean>; onExpand: (id: string, open: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile} = useSidebar()
  const {sessions, directories, loading, error, refresh, deleteSession, patchSession, liveSession} = useSessions()
  const {workspaces, loading: workspacesLoading, error: workspacesError, refresh: refreshWorkspaces} = useWorkspaces()
  const [selectedRecord, setSelected] = useState<Session | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingSessionAction | null>(null)
  const [pendingRename, setPendingRename] = useState<PendingSessionAction | null>(null)
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
    onClick={() => setOpenMobile(false)} onDelete={(session, restoreFocus) => setPendingDelete({session, restoreFocus})}
    onRename={(session, restoreFocus) => setPendingRename({session, restoreFocus})}/>)
  const invalidate = (owner: string | null) => {
    if (owner === workspaceId) void refresh()
    if (owner) setRevisions(current => ({...current, [owner]: (current[owner] ?? 0) + 1}))
  }
  const remove = async () => {
    if (!pendingDelete) return
    const {session} = pendingDelete
    const owner = session.workspace_id ?? null
    // 失败时抛出，确认弹框保持打开并显示说明
    await deleteSession(session.session_id, owner)
    setSelected(current => current?.session_id === session.session_id ? null : current)
    if (sessionId === session.session_id) router.push(owner ? workspaceHref(owner) : '/')
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
          <WorkspaceRowMenu workspace={workspace}><Link href={home} className="workspace-directory-row" aria-expanded={open} aria-current={pathname === home ? 'page' : undefined}
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
          </Link></WorkspaceRowMenu>
          <div className="workspace-directory-children" aria-label={`${workspace.name}的对话`} hidden={!open}>
            <ExpandedWorkspaceSessions id={workspace.id} open={open} active={active} revision={revisions[workspace.id] ?? 0}
              directory={directories[workspace.id]} retryActive={refresh}
              selected={active && selected?.workspace_id === workspace.id ? currentRows.find(item => item.session_id === selected.session_id) ?? null : null}
              renderRows={rows => renderRows(rows, workspace.id)}/>
          </div>
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
    {pendingDelete && <DeleteSessionDialog open onOpenChange={open => {if (!open) setPendingDelete(null)}} onConfirm={remove}
      onRestoreFocus={pendingDelete.restoreFocus}/>}
    {pendingRename && <RenameSessionDialog sessionId={pendingRename.session.session_id} currentTitle={pendingRename.session.title} open
      onOpenChange={open => {if (!open) setPendingRename(null)}} onRestoreFocus={pendingRename.restoreFocus} onSaved={title => {
        const id = pendingRename.session.session_id
        const owner = pendingRename.session.workspace_id ?? null
        patchSession(id, {title}, owner)
        setSelected(current => current?.session_id === id ? {...current, title} : current)
        invalidate(owner)
      }}/>}
  </>
}
