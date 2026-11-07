import React from 'react'
import {usePathname} from '@/lib/navigation'
import {SidebarProvider} from '@/components/ui/sidebar'
import {SessionsProvider} from '@/providers/sessions-provider'
import {WorkspacesProvider} from '@/providers/workspaces-provider'
import {parseWorkspaceRoute} from '@/lib/workspace-route'
import {LeftPanel} from '@/components/left-panel'
import {MainShell} from '@/components/sidebar-chrome'

/** 独立设置页使用完整画布。 */
function isBareRoute(pathname: string | null): boolean {
  return pathname === '/settings'
}

export function AppShell({children}: {children: React.ReactNode}) {
  const pathname = usePathname()
  // 侧栏会话列表按范围划分：独立对话一份，每个工作区各一份；换范围时重新挂载
  const {workspaceId} = parseWorkspaceRoute(pathname)

  if (isBareRoute(pathname)) {
    return <div className="h-full overflow-y-auto">{children}</div>
  }

  return (
    <WorkspacesProvider>
      <SessionsProvider key={workspaceId ?? 'independent'} workspaceId={workspaceId}>
        <SidebarProvider
          style={{
            '--sidebar-width': '22.5rem',
            '--sidebar-width-icon': '3rem',
          } as React.CSSProperties}
        >
          <LeftPanel/>
          <MainShell>
            {children}
          </MainShell>
        </SidebarProvider>
      </SessionsProvider>
    </WorkspacesProvider>
  )
}
