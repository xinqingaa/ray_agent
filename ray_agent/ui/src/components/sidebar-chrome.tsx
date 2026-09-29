'use client'

import type {ReactNode} from 'react'
import Link from 'next/link'
import {usePathname} from 'next/navigation'
import {Home, Settings} from 'lucide-react'
import {SidebarTrigger, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {ThemeToggle} from '@/components/theme-toggle'
import {cn} from '@/lib/utils'

export function SidebarChrome({className}: {className?: string}) {
  const pathname = usePathname()

  return (
    <div
      className={cn(
        'flex h-8 flex-row flex-nowrap items-center gap-1',
        'group-data-[collapsible=icon]:flex-col',
        className,
      )}
    >
      <SidebarTrigger aria-label="收起或展开侧栏"/>
      <Button variant="ghost" size="icon" className="size-7" asChild>
        <Link href="/" aria-label="回到首页">
          <Home/>
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-7', pathname === '/settings' && 'bg-sidebar-accent')}
        asChild
      >
        <Link href="/settings" aria-label="设置" aria-current={pathname === '/settings' ? 'page' : undefined}>
          <Settings/>
        </Link>
      </Button>
      <ThemeToggle/>
    </div>
  )
}

/** 仅移动端抽屉关闭时，在主区保留同一组按钮 */
export function MainShell({children}: {children: ReactNode}) {
  const {isMobile} = useSidebar()

  return (
    <div className="relative flex-1 min-w-0 bg-background h-screen overflow-hidden">
      {isMobile && (
        <div className="absolute top-2 left-2 z-50">
          <SidebarChrome/>
        </div>
      )}
      <div className={cn('h-full', isMobile && 'pt-11')}>
        {children}
      </div>
    </div>
  )
}
