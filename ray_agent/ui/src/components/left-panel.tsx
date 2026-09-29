'use client'

import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {usePathname} from 'next/navigation'
import {Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {Plus, Settings} from 'lucide-react'
import {Kbd, KbdGroup} from '@/components/ui/kbd'
import {SessionList} from '@/components/session-list'
import {SidebarChrome} from '@/components/sidebar-chrome'

export function LeftPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile} = useSidebar()

  const createTask = () => {
    setOpenMobile(false)
    router.push('/')
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarChrome/>
        <Button variant="ghost" size="icon" data-navigate aria-label="新建任务" title="新建任务"
          className="hidden size-8 self-center group-data-[collapsible=icon]:flex" onClick={createTask}>
          <Plus/>
        </Button>
      </SidebarHeader>
      <SidebarContent className="p-2 group-data-[collapsible=icon]:hidden">
        <Button
          variant="outline"
          className="cursor-pointer mb-3"
          data-navigate
          onClick={createTask}
        >
          <Plus/>
          新建任务
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <SessionList/>
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" asChild
          className="w-full justify-start gap-2.5 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
          <Link href="/settings" onClick={() => setOpenMobile(false)} title="设置" aria-label="设置"
            aria-current={pathname === '/settings' ? 'page' : undefined}>
            <Settings className="size-4 shrink-0"/>
            <span className="group-data-[collapsible=icon]:hidden">设置</span>
          </Link>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
