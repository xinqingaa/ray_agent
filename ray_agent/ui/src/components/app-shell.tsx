import React from 'react'
import {usePathname} from '@/lib/navigation'
import {SidebarProvider} from '@/components/ui/sidebar'
import {SessionsProvider} from '@/providers/sessions-provider'
import {LeftPanel} from '@/components/left-panel'
import {MainShell} from '@/components/sidebar-chrome'

/** 独立设置页使用完整画布。 */
function isBareRoute(pathname: string | null): boolean {
  return pathname === '/settings'
}

export function AppShell({children}: {children: React.ReactNode}) {
  const pathname = usePathname()

  if (isBareRoute(pathname)) {
    return <div className="h-full overflow-y-auto">{children}</div>
  }

  return (
    <SessionsProvider>
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
  )
}
