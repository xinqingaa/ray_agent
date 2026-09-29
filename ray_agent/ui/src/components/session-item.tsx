'use client'

import {useCallback} from 'react'
import {MoreHorizontal, Pencil, Trash} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {useMounted} from '@/hooks/use-mounted'
import {cn, formatClockTime, formatDayLabel} from '@/lib/utils'
import type {Session} from '@/lib/api'

type SessionItemProps = {
  session: Session
  isActive: boolean
  onClick: (sessionId: string) => void
  onDelete: (session: Session) => void
  onRename?: (session: Session) => void
}

const STATUS_INDICATOR: Record<Session['status'], {label: string; className: string}> = {
  pending: {label: '准备中', className: 'bg-state-running'},
  running: {label: '运行中', className: 'bg-state-running'},
  waiting: {label: '等你处理', className: 'bg-state-waiting'},
  completed: {label: '已完成', className: 'bg-state-success'},
  failed: {label: '失败', className: 'bg-state-failed'},
  cancelled: {label: '已停止', className: 'bg-state-stopped'},
  interrupted: {label: '已中断', className: 'bg-state-interrupted'},
}

/** 会话列表项：仅选中项的左侧强调条使用状态色，状态名称保留在提示和可访问名称中。 */
export function SessionItem({session, isActive, onClick, onDelete, onRename}: SessionItemProps) {
  const mounted = useMounted()

  const handleClick = useCallback(() => {
    onClick(session.session_id)
  }, [onClick, session.session_id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(session)
  }, [onDelete, session])

  const dayLabel = formatDayLabel(session.latest_message_at)
  const clockLabel = formatClockTime(session.latest_message_at)
  const timeLabel = [dayLabel, clockLabel].filter(Boolean).join(' ')
  const title = session.title || '新任务'
  const status = STATUS_INDICATOR[session.status]

  return (
    <div
      className={cn(
        'group/session relative rounded-md py-2.5 pr-1.5 pl-2.5 hover:bg-sidebar-accent/70',
        isActive && 'bg-sidebar-accent',
      )}
    >
      {isActive && <span className={cn('absolute inset-y-1.5 left-0 w-0.5 rounded-full', status.className)} aria-hidden/>}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-navigate
            onClick={handleClick}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`${title}，${status.label}`}
            className="block w-full min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="truncate pr-7 text-sm leading-5" dir="auto" title={title}>{title}</p>
            {timeLabel && <span className="block min-w-0 truncate text-xs tabular-nums text-muted-foreground">{timeLabel}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>{status.label}</TooltipContent>
      </Tooltip>
      {mounted ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="absolute top-1.5 right-1 text-muted-foreground opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
              aria-label={`${title} 的操作`}
            >
              <MoreHorizontal/>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem onSelect={() => onRename?.(session)}>
              <Pencil/>
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash/>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="absolute top-1.5 right-1 size-6"/>
      )}
    </div>
  )
}
