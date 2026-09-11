'use client'

import {useRouter} from 'next/navigation'
import {Sidebar, SidebarContent, SidebarHeader} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {Plus} from 'lucide-react'
import {Kbd, KbdGroup} from '@/components/ui/kbd'
import {SessionList} from '@/components/session-list'
import {SidebarChrome} from '@/components/sidebar-chrome'

export function LeftPanel() {
  const router = useRouter()

  return (
    <Sidebar collapsible="icon">
      {/* 顶部固定：收起/展开、首页、设置；收起时只隐藏下方列表 */}
      <SidebarHeader>
        <SidebarChrome/>
      </SidebarHeader>
      {/* 会话列表与新建任务：收起时隐藏 */}
      <SidebarContent className="p-2 group-data-[collapsible=icon]:hidden">
        {/* 新建任务 */}
        <Button
          variant="outline"
          className="cursor-pointer mb-3"
          onClick={() => router.push('/')}
        >
          <Plus/>
          新建任务
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        {/* 会话列表 */}
        <SessionList/>
      </SidebarContent>
    </Sidebar>
  )
}
