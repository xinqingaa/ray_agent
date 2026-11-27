import {useEffect, useState, type CSSProperties, type ReactNode} from 'react'
import {useLocation} from 'react-router'
import {Link, useRouter} from '@/lib/navigation'
import {SidebarProvider, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {Folder, MessagesSquare, Package, Plus, Settings, Sparkles} from '@/components/ui/icons'
import {SessionsProvider} from '@/providers/sessions-provider'
import {WorkspacesProvider, useWorkspace} from '@/providers/workspaces-provider'
import {parseWorkspaceRoute, workspaceBackgroundHref, workspaceHref} from '@/lib/workspace-route'
import {WorkspacePendingProvider, useWorkspacePending} from '@/providers/workspace-pending'
import {describeWorkspace} from '@/lib/workspace-state'
import {LeftPanel} from '@/components/left-panel'
import {MainShell} from '@/components/sidebar-chrome'
import {isSettingsPath, OPEN_SETTINGS_EVENT, settingsEntry, settingsHref, settingsSource, type SettingsSectionKey} from '@/lib/settings-navigation'
import {skillsHref} from '@/lib/skill-route'
import {ThemeToggle} from '@/components/theme-toggle'

type RailSection = 'independent' | 'workspaces' | 'skills' | 'components' | 'settings'

function NavigationRail({workspaceId, section}: {workspaceId: string | null; section: RailSection}) {
  const {setOpenMobile} = useSidebar()
  const currentLocation = useLocation()
  const router = useRouter()
  const inSettings = section === 'settings'
  useEffect(() => {
    const open = (event: Event) => {
      const href = settingsHref((event as CustomEvent<{section?: SettingsSectionKey}>).detail?.section)
      setOpenMobile(false)
      if (inSettings) router.replace(href, currentLocation.state)
      else router.push(href, settingsEntry(currentLocation))
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open)
  }, [currentLocation, inSettings, router, setOpenMobile])
  const lookup = useWorkspace(workspaceId)
  const {count: workspacePending} = useWorkspacePending()
  const condition = lookup.phase === 'ready' ? describeWorkspace(lookup.workspace) : null
  const newHref = workspaceId ? workspaceHref(workspaceId) : '/'
  const groups = [
    [{key: 'independent', label: '独立对话', Icon: MessagesSquare, href: '/'}, {key: 'workspaces', label: '工作区', Icon: Folder, href: '/workspaces'}],
    [{key: 'skills', label: 'Skill', Icon: Sparkles, href: section === 'skills' ? currentLocation.pathname + currentLocation.search : skillsHref(workspaceId)},
      {key: 'components', label: '运行组件', Icon: Package, href: '/components'}],
  ] as const

  return <nav className="app-rail" aria-label="全局导航">
    <Tooltip delayDuration={240}>
      <TooltipTrigger asChild>
        {condition?.archived || condition?.deleting ?
          <Button className="rail-new" size="icon" aria-label="新对话" disabled><Plus/></Button> :
          <Button asChild className="rail-new" size="icon">
            <Link href={newHref} aria-label="新对话" onClick={() => {
              setOpenMobile(false)
              if (location.pathname === newHref) document.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus()
            }}><Plus/></Link>
          </Button>}
      </TooltipTrigger>
      <TooltipContent side="right">新对话</TooltipContent>
    </Tooltip>
    <div className="rail-groups" data-section={section}>
      <span className="rail-indicator" aria-hidden/>
      {groups.map((group, index) => <div key={index} className="rail-group">
        {group.map(({key, label, Icon, href}) => <Tooltip key={key} delayDuration={240}>
          <TooltipTrigger asChild>
            <Link href={href} className="rail-action" aria-label={key === 'workspaces' && workspacePending ? `${label}，背景有待处理事项` : label}
              state={key === 'skills' ? (section === 'skills' ? currentLocation.state : {returnTo: currentLocation.pathname + currentLocation.search + currentLocation.hash}) : undefined}
              aria-current={key === section ? 'page' : undefined} onClick={() => setOpenMobile(false)}><Icon/>
                {key === 'workspaces' && !!workspacePending && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-state-waiting ring-2 ring-rail" aria-hidden/>}
              </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>)}
      </div>)}
    </div>
    <div className="rail-footer">
      <ThemeToggle className="rail-action" quick/>
      <Tooltip delayDuration={240}>
        <TooltipTrigger asChild><Link className="rail-action" aria-label="设置" aria-current={inSettings ? 'page' : undefined}
          href={inSettings ? currentLocation.pathname + currentLocation.search : settingsHref()}
          state={inSettings ? currentLocation.state : settingsEntry(currentLocation)} onClick={() => setOpenMobile(false)}><Settings/></Link></TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>
    </div>
  </nav>
}

export function AppShell({children}: {children: ReactNode}) {
  const location = useLocation()
  const {pathname} = location
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const inSettings = isSettingsPath(pathname)
  const source = inSettings ? settingsSource(location.state) : null
  const {workspaceId} = parseWorkspaceRoute(source?.pathname ?? pathname)
  useEffect(() => {
    if (workspaceId) setExpanded(current => Object.hasOwn(current, workspaceId) ? current : {...current, [workspaceId]: true})
  }, [workspaceId])
  const section: RailSection = inSettings || pathname === '/evaluation' ? 'settings' : pathname === '/skills' ? 'skills' : pathname === '/components' ? 'components' : pathname.startsWith('/workspaces') ? 'workspaces' : 'independent'
  const listAvailable = section === 'independent' || section === 'workspaces'

  return <WorkspacesProvider>
    <SidebarProvider className="app-shell" drawerBreakpoint={1101}
      style={{'--sidebar-width': '252px'} as CSSProperties}>
      <WorkspacePendingProvider workspaceId={workspaceId} background={workspaceId != null && pathname === workspaceBackgroundHref(workspaceId)}>
        <NavigationRail workspaceId={workspaceId} section={section}/>
        <SessionsProvider workspaceId={workspaceId}>
          {section === 'skills' ? children : <>
            {listAvailable && <LeftPanel scope={section} expanded={expanded}
              onExpand={(id, open) => setExpanded(current => ({...current, [id]: open}))}/>}
            <MainShell listAvailable={listAvailable}>{children}</MainShell>
          </>}
        </SessionsProvider>
      </WorkspacePendingProvider>
    </SidebarProvider>
  </WorkspacesProvider>
}
