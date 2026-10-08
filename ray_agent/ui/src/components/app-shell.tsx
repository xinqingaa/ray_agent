'use client'

import React from 'react'
import {usePathname} from 'next/navigation'
import {SidebarProvider} from '@/components/ui/sidebar'
import {SessionsProvider} from '@/providers/sessions-provider'
import {LeftPanel} from '@/components/left-panel'
import {ProjectsProvider} from '@/providers/projects-provider'
import {MainShell} from '@/components/sidebar-chrome'

/** 开发用路由（组件状态目录）不带会话侧栏，也不连接会话列表 */
function isBareRoute(pathname: string | null): boolean {
  return pathname?.startsWith('/dev/') ?? false
}

export function AppShell({children}: {children: React.ReactNode}) {
  const pathname = usePathname()

  if (isBareRoute(pathname)) {
    return <div className="h-full overflow-y-auto">{children}</div>
  }

  return (
    <ProjectsProvider><SessionsProvider>
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
    </SessionsProvider></ProjectsProvider>
  )
}
