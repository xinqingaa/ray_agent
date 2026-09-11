'use client'

import type {ReactNode} from 'react'
import Link from 'next/link'
import {Home} from 'lucide-react'
import {SidebarTrigger, useSidebar} from '@/components/ui/sidebar'
import {ManusSettings} from '@/components/manus-settings'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'

export function SidebarChrome({className}: {className?: string}) {
  return (
    <div
      className={cn(
        'flex flex-row flex-nowrap items-center gap-1',
        'group-data-[collapsible=icon]:flex-col',
        className,
      )}
    >
      <SidebarTrigger className="cursor-pointer"/>
      <Button variant="ghost" size="icon" className="cursor-pointer size-7" asChild>
        <Link href="/" aria-label="回到首页">
          <Home/>
        </Link>
      </Button>
      <ManusSettings/>
    </div>
  )
}

/** 仅移动端抽屉关闭时，在主区保留同一组按钮 */
export function MainShell({children}: {children: ReactNode}) {
  const {isMobile} = useSidebar()

  return (
    <div className="relative flex-1 bg-[#f8f8f7] h-screen overflow-hidden">
      {isMobile && (
        <div className="absolute top-2 left-2 z-50">
          <SidebarChrome/>
        </div>
      )}
      <div className={cn('h-full', isMobile && 'pl-20')}>
        {children}
      </div>
    </div>
  )
}
