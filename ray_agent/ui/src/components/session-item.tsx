'use client'

import {useCallback} from 'react'
import {MoreHorizontal, Trash} from 'lucide-react'
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
}

const STATUS_DOT: Record<Session['status'], {label: string; className: string}> = {
  pending: {label: '准备中', className: 'bg-state-running'},
  running: {label: '运行中', className: 'bg-state-running'},
  waiting: {label: '等你处理', className: 'bg-state-waiting'},
  completed: {label: '已完成', className: 'bg-state-success'},
  failed: {label: '失败', className: 'bg-state-failed'},
  cancelled: {label: '已停止', className: 'bg-state-stopped'},
  interrupted: {label: '已中断', className: 'bg-state-interrupted'},
}

/** 会话列表项：标题自然换行，状态在右下角用色点提示；选中项左侧有强调条。 */
export function SessionItem({session, isActive, onClick, onDelete}: SessionItemProps) {
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
  const status = STATUS_DOT[session.status]

  return (
    <div
      className={cn(
        'group/session relative rounded-md py-1.5 pr-1 pl-2.5 hover:bg-sidebar-accent/70',
        isActive && 'bg-sidebar-accent',
      )}
    >
      {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal" aria-hidden/>}
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
            <p className="pr-7 text-sm leading-5 whitespace-normal [overflow-wrap:anywhere]">{title}</p>
            <div className="flex min-w-0 items-center justify-between gap-2">
              {timeLabel && <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">{timeLabel}</span>}
              <span className={cn('ml-auto size-2 shrink-0 rounded-full', status.className)} aria-hidden/>
            </div>
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
