'use client'

import type {ReactNode} from 'react'
import Link from 'next/link'
import {SidebarTrigger, useSidebar} from '@/components/ui/sidebar'
import {BrandMark} from '@/components/brand-mark'
import {cn} from '@/lib/utils'

/** 侧栏顶部只保留产品入口与折叠控制。 */
export function SidebarChrome() {
  const {state, isMobile, setOpenMobile} = useSidebar()

  return (
    <div className={cn('flex h-9 items-center justify-between gap-2', state === 'collapsed' && !isMobile && 'justify-center')}>
      <Link href="/" onClick={() => setOpenMobile(false)}
        className={cn('flex min-w-0 items-center gap-2 rounded-sm px-1 text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring', state === 'collapsed' && !isMobile && 'hidden')}>
        <BrandMark className="size-5"/>
        <span className="truncate">RayAgent</span>
      </Link>
      <SidebarTrigger aria-label={state === 'collapsed' && !isMobile ? '展开侧栏' : '收起侧栏'} className="shrink-0"/>
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
      <div className={cn('h-full', isMobile && 'pt-11')}>
        {children}
      </div>
    </div>
  )
}
