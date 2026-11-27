import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Link, usePathname} from '@/lib/navigation'
import {useSidebar} from '@/components/ui/sidebar'
import {IconAction} from '@/components/ui/icon-action'
import {SegmentThumb, useSegmentThumb} from '@/components/ui/segment-thumb'
import {Layers, Library, MessageCircle, PanelLeftIcon, Search} from '@/components/ui/icons'
import {DataCleanupNotice} from './data-cleanup-notice'
import {WorkspaceDeletionNotice} from './workspace/workspace-deletion-notice'
import {useWorkspace} from '@/providers/workspaces-provider'
import {useWorkspacePending} from '@/providers/workspace-pending'
import {useSessions} from '@/hooks/use-sessions'
import {parseWorkspaceRoute, workspaceBackgroundHref, workspaceHref, workspaceKnowledgeHref} from '@/lib/workspace-route'
import {isSettingsPath} from '@/lib/settings-navigation'
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
  const knowledge = route.workspaceId !== null && pathname.replace(/\/$/, '') === workspaceKnowledgeHref(route.workspaceId)
  const searchAvailable = Boolean(home || pathname === '/' || sessionId)
  const listOpen = listAvailable && (isMobile ? openMobile : open)
  const pageTitle = isSettingsPath(pathname) ? '设置' : pathname === '/skills' ? 'Skill' : pathname === '/components' ? '运行组件' : pathname === '/evaluation' ? '评测' : pathname === '/workspaces' ? '工作区' : '新对话'

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
        {home && <WorkspaceViewNav home={home} workspaceId={route.workspaceId!} background={background} knowledge={knowledge} workspacePending={workspacePending}/>}
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

export function WorkspaceViewNav({home, workspaceId, background, knowledge, workspacePending}: {
  home: string
  workspaceId: string
  background: boolean
  knowledge: boolean
  workspacePending: number | null
}) {
  const navRef = useRef<HTMLElement>(null)
  const activeKey = background ? 'background' : knowledge ? 'knowledge' : 'chat'
  const thumb = useSegmentThumb(navRef, activeKey, 'chat\u0000background\u0000knowledge')
  return <nav ref={navRef} aria-label="工作区视图" data-segment-label-gap="6" className="app-view-links">
    <SegmentThumb thumb={thumb} className="rounded-[10px] bg-background shadow-(--paper-shadow)"/>
    <Link href={home} aria-label="对话" title="对话" aria-current={activeKey === 'chat' ? 'page' : undefined}>
      <MessageCircle/>
      <span data-segment-label=""><span className="min-w-0 overflow-hidden">对话</span></span>
    </Link>
    <Link href={workspaceBackgroundHref(workspaceId)} aria-label={workspacePending ? `背景，${workspacePending} 项待处理` : '背景'}
      title="背景" aria-current={activeKey === 'background' ? 'page' : undefined}>
      <Layers/>
      <span data-segment-label=""><span className="min-w-0 overflow-hidden">背景</span></span>
      {!!workspacePending && <b className="ml-1 text-[11px] font-medium text-state-waiting tabular-nums" aria-hidden>{workspacePending}</b>}
    </Link>
    <Link href={workspaceKnowledgeHref(workspaceId)} aria-label="知识" title="知识"
      aria-current={activeKey === 'knowledge' ? 'page' : undefined}>
      <Library/>
      <span data-segment-label=""><span className="min-w-0 overflow-hidden">知识</span></span>
    </Link>
  </nav>
}
