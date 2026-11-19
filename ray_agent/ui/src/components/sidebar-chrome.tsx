import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Link, usePathname} from '@/lib/navigation'
import {useSidebar} from '@/components/ui/sidebar'
import {IconAction} from '@/components/ui/icon-action'
import {Layers, MessageCircle, PanelLeftIcon, Search} from '@/components/ui/icons'
import {DataCleanupNotice} from './data-cleanup-notice'
import {WorkspaceDeletionNotice} from './workspace/workspace-deletion-notice'
import {useWorkspace} from '@/providers/workspaces-provider'
import {useWorkspacePending} from '@/providers/workspace-pending'
import {useSessions} from '@/hooks/use-sessions'
import {parseWorkspaceRoute, workspaceBackgroundHref, workspaceHref} from '@/lib/workspace-route'
import {ConversationSearch} from './conversation-search'

const TopbarSlots = createContext<{title: HTMLElement | null; actions: HTMLElement | null} | null>(null)

export function TopbarTitle({children}: {children: ReactNode}) {
  const slot = useContext(TopbarSlots)?.title
  return slot ? createPortal(children, slot) : null
}

export function TopbarActions({children}: {children: ReactNode}) {
  const slot = useContext(TopbarSlots)?.actions
  return slot ? createPortal(children, slot) : null
}

export function MainShell({children, listAvailable}: {children: ReactNode; listAvailable: boolean}) {
  const pathname = usePathname()
  const route = parseWorkspaceRoute(pathname)
  const workspace = useWorkspace(route.workspaceId)
  const {count: workspacePending} = useWorkspacePending()
  const {sessions} = useSessions()
  const {open, isMobile, openMobile, toggleSidebar} = useSidebar()
  const [titleSlot, setTitleSlot] = useState<HTMLSpanElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchButton = useRef<HTMLButtonElement>(null)
  const sessionId = route.sessionId ?? pathname.match(/^\/sessions\/([^/]+)/)?.[1]
  const displayedTitle = sessions.find(item => item.session_id === sessionId)?.title || '对话'
  const home = route.workspaceId ? workspaceHref(route.workspaceId) : null
  const background = Boolean(home && pathname === `${home}/background`)
  const workspaceName = workspace.phase === 'ready' ? workspace.workspace.name : '工作区'
  const searchAvailable = Boolean(home || pathname === '/' || sessionId)
  const listOpen = listAvailable && (isMobile ? openMobile : open)
  const pageTitle = pathname === '/components' ? '运行组件' : pathname === '/workspaces' ? '工作区' : '新对话'

  useEffect(() => {
    if (!searchAvailable) return
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.key.toLowerCase() !== 'k' ||
          !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey ||
          document.querySelector('[role="dialog"][data-state="open"]')) return
      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [searchAvailable])

  return <TopbarSlots.Provider value={{title: titleSlot, actions: actionsSlot}}>
    <div className="app-main" data-inset={!listAvailable || isMobile || !open}>
      <header className="app-topbar">
        {listAvailable && <IconAction label={listOpen ? '收起左侧列表' : '展开左侧列表'} aria-expanded={listOpen}
          className="topbar-action shrink-0" onClick={toggleSidebar}><PanelLeftIcon/></IconAction>}
        <nav aria-label="当前位置" className="app-breadcrumb" data-workspace-session={Boolean(home && sessionId)}>
          {home && sessionId ? <Link href={home} className="app-workspace-crumb truncate text-muted-foreground" title={workspaceName}>{workspaceName}</Link> : null}
          {home && sessionId && <span aria-hidden className="app-crumb-divider text-faint">/</span>}
          {sessionId ? <span className="app-session-crumb font-semibold">
            <span ref={setTitleSlot} className="app-title-slot"/>
            <span className="app-title-fallback" title={displayedTitle}>{displayedTitle}</span>
          </span> : <span className="truncate font-semibold">{home ? workspaceName : pageTitle}</span>}
        </nav>
        {home && <nav aria-label="工作区视图" className="app-view-links">
          <Link href={home} aria-label="对话" title="对话" aria-current={!background ? 'page' : undefined}><MessageCircle/><span>对话</span></Link>
          <Link href={workspaceBackgroundHref(route.workspaceId!)} aria-label={workspacePending ? `背景，${workspacePending} 项待处理` : '背景'}
            title="背景" aria-current={background ? 'page' : undefined}><Layers/><span>背景</span>
            {!!workspacePending && <b className="ml-1 text-[11px] font-medium text-state-waiting tabular-nums" aria-hidden>{workspacePending}</b>}
          </Link>
        </nav>}
        <div className="app-top-actions">
          <div ref={setActionsSlot} className="app-top-actions-slot"/>
          {searchAvailable && <IconAction ref={searchButton} label="搜索对话" aria-keyshortcuts="Meta+k Control+k"
            className="topbar-action" onClick={() => setSearchOpen(true)}><Search/></IconAction>}
        </div>
      </header>
      {searchAvailable && <ConversationSearch key={route.workspaceId ?? 'independent'} open={searchOpen}
        onOpenChange={setSearchOpen} workspaceId={route.workspaceId} onRestoreFocus={() => searchButton.current?.focus()}/>}
      <DataCleanupNotice/>
      <WorkspaceDeletionNotice/>
      <div className="app-stage">
        <div className="app-paper">{children}</div>
      </div>
    </div>
  </TopbarSlots.Provider>
}
