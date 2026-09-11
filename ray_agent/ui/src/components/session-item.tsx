'use client'

import {useCallback, useEffect, useState} from 'react'
import {Loader2, MoreHorizontal, Trash} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {Item, ItemContent} from '@/components/ui/item'
import {formatClockTime, formatDayLabel} from '@/lib/utils'
import type {Session} from '@/lib/api'

type SessionItemProps = {
  session: Session
  isActive: boolean
  onClick: (sessionId: string) => void
  onDelete: (session: Session) => void
}

/**
 * 单个会话列表项：标题、摘要、时间各一行；右上角运行中转圈，否则为菜单。
 */
export function SessionItem({session, isActive, onClick, onDelete}: SessionItemProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleClick = useCallback(() => {
    onClick(session.session_id)
  }, [onClick, session.session_id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(session)
  }, [onDelete, session])

  const description = session.latest_message || '暂无消息'
  const dayLabel = formatDayLabel(session.latest_message_at)
  const clockLabel = formatClockTime(session.latest_message_at)
  const timeLabel = [dayLabel, clockLabel].filter(Boolean).join(' ')
  const isRunning = session.status === 'running' || session.status === 'waiting'

  return (
    <Item
      className={`p-2 hover:bg-white cursor-pointer ${isActive ? 'bg-white' : ''}`}
      onClick={handleClick}
    >
      <ItemContent className="gap-0.5 min-w-0 w-full">
        <div className="flex items-center gap-1 min-w-0">
          <p className="text-sm font-medium truncate flex-1 min-w-0">
            {session.title || '新任务'}
          </p>
          {isRunning ? (
            <Loader2 className="size-4 animate-spin shrink-0 text-muted-foreground" />
          ) : mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="cursor-pointer shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal/>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer"
                  onClick={handleDelete}
                >
                  <Trash/>
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {description}
        </p>
        {timeLabel && (
          <p className="text-xs text-muted-foreground truncate">{timeLabel}</p>
        )}
      </ItemContent>
    </Item>
  )
}
