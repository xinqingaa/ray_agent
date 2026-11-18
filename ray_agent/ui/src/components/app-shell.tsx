import {useState, type CSSProperties, type ReactNode} from 'react'
import {Link, usePathname} from '@/lib/navigation'
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
import {SettingsDialog} from '@/components/settings/settings-dialog'
import {ThemeToggle} from '@/components/theme-toggle'

function NavigationRail({workspaceId, section}: {workspaceId: string | null; section: 'independent' | 'workspaces' | 'components'}) {
  const {setOpenMobile} = useSidebar()
  const [settings, setSettings] = useState<'general' | 'skills' | null>(null)
  const lookup = useWorkspace(workspaceId)
  const {count: workspacePending} = useWorkspacePending()
  const condition = lookup.phase === 'ready' ? describeWorkspace(lookup.workspace) : null
  const newHref = workspaceId ? workspaceHref(workspaceId) : '/'
  const groups = [
    [{key: 'independent', label: '独立对话', Icon: MessagesSquare, href: '/'}, {key: 'workspaces', label: '工作区', Icon: Folder, href: '/workspaces'}],
    [{key: 'skills', label: 'Skill', Icon: Sparkles}, {key: 'components', label: '运行组件', Icon: Package, href: '/components'}],
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
        {group.map(({key, label, Icon, ...target}) => <Tooltip key={key} delayDuration={240}>
          <TooltipTrigger asChild>
            {'href' in target ? <Link href={target.href} className="rail-action" aria-label={key === 'workspaces' && workspacePending ? `${label}，背景有待处理事项` : label}
              aria-current={key === section ? 'page' : undefined} onClick={() => setOpenMobile(false)}><Icon/>
                {key === 'workspaces' && !!workspacePending && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-state-waiting ring-2 ring-rail" aria-hidden/>}
              </Link> :
              <button type="button" className="rail-action" aria-label={label} onClick={() => {setOpenMobile(false); setSettings('skills')}}><Icon/></button>}
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>)}
      </div>)}
    </div>
    <div className="rail-footer">
      <ThemeToggle className="rail-action" quick/>
      <Tooltip delayDuration={240}>
        <TooltipTrigger asChild><button type="button" className="rail-action" aria-label="设置"
          onClick={() => {setOpenMobile(false); setSettings('general')}}><Settings/></button></TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>
    </div>
    <SettingsDialog open={settings !== null} initialSection={settings ?? 'general'}
      onOpenChange={open => {if (!open) setSettings(null)}}/>
  </nav>
}

export function AppShell({children}: {children: ReactNode}) {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const {workspaceId} = parseWorkspaceRoute(pathname)
  const section = pathname === '/components' ? 'components' : pathname.startsWith('/workspaces') ? 'workspaces' : 'independent'

  if (pathname === '/settings') return <div className="h-full overflow-y-auto">{children}</div>

  return <WorkspacesProvider>
    <SidebarProvider className="app-shell" drawerBreakpoint={1101}
      style={{'--sidebar-width': '252px'} as CSSProperties}>
      <WorkspacePendingProvider workspaceId={workspaceId} background={workspaceId != null && pathname === workspaceBackgroundHref(workspaceId)}>
        <NavigationRail workspaceId={workspaceId} section={section}/>
        <SessionsProvider key={workspaceId ?? 'independent'} workspaceId={workspaceId}>
          {section !== 'components' && <LeftPanel scope={section} expanded={expanded}
            onExpand={(id, open) => setExpanded(current => ({...current, [id]: open}))}/>}
          <MainShell listAvailable={section !== 'components'}>{children}</MainShell>
        </SessionsProvider>
      </WorkspacePendingProvider>
    </SidebarProvider>
  </WorkspacesProvider>
}
