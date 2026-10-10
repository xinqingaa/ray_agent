'use client'

import type {ReactNode} from 'react'
import Link from 'next/link'
import {SidebarTrigger, useSidebar} from '@/components/ui/sidebar'
import {BrandMark} from '@/components/brand-mark'
import {cn} from '@/lib/utils'
import {DataCleanupNotice} from './data-cleanup-notice'

/** 侧栏顶部是产品入口、当前列表的新建按钮和折叠控制。 */
export function SidebarChrome({action}: {action?: ReactNode}) {
  const {state, isMobile, setOpenMobile} = useSidebar()
  const iconRail = state === 'collapsed' && !isMobile

  return (
    <div className={cn('flex h-9 items-center justify-between gap-1', iconRail && 'justify-center')}>
      <Link href="/" onClick={() => setOpenMobile(false)}
        className={cn('flex min-w-0 items-center gap-2 rounded-sm px-1 text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring', iconRail && 'hidden')}>
        <BrandMark className="size-5"/>
        <span className="truncate">RayAgent</span>
      </Link>
      <div className={cn('flex shrink-0 items-center', iconRail && 'contents')}>
        {!iconRail && action}
        <SidebarTrigger aria-label={iconRail ? '展开侧栏' : '收起侧栏'} className="shrink-0"/>
      </div>
    </div>
  )
}

/** 移动端抽屉关闭时，在主区保留侧栏入口。 */
export function MainShell({children}: {children: ReactNode}) {
  const {isMobile} = useSidebar()

  return (
    <div className="relative flex-1 min-w-0 bg-background h-screen overflow-hidden">
      {isMobile && (
        <div className="absolute top-2 left-2 z-50">
          <SidebarTrigger aria-label="打开侧栏"/>
        </div>
      )}
      <div className={cn('flex h-full flex-col', isMobile && 'pt-11')}>
        <DataCleanupNotice/>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
