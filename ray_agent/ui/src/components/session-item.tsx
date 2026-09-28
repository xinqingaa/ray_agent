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
import {useMounted} from '@/hooks/use-mounted'
import {cn, formatClockTime, formatDayLabel} from '@/lib/utils'
import type {Session} from '@/lib/api'

type SessionItemProps = {
  session: Session
  isActive: boolean
  onClick: (sessionId: string) => void
  onDelete: (session: Session) => void
}

const STATUS_BADGE: Record<string, {label: string; className: string}> = {
  running: {label: '运行中', className: 'text-state-running'},
  pending: {label: '运行中', className: 'text-state-running'},
  waiting: {label: '等你处理', className: 'bg-state-waiting-soft text-state-waiting'},
  failed: {label: '失败', className: 'bg-state-failed-soft text-state-failed'},
  interrupted: {label: '已中断', className: 'bg-state-interrupted-soft text-state-interrupted'},
}

function StatusBadge({status}: {status: string}) {
  const badge = STATUS_BADGE[status]
  if (!badge) return null
  const running = status === 'running' || status === 'pending'
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs leading-5', badge.className)}>
      {running && <span className="size-1.5 rounded-full bg-state-running" aria-hidden/>}
      {badge.label}
    </span>
  )
}

/**
 * 会话列表项：标题一行、时间与状态徽标一行；选中项左侧有强调条。
 */
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

  return (
    <div
      className={cn(
        'group/session relative flex items-start gap-1 rounded-md py-1.5 pr-1 pl-2.5 hover:bg-sidebar-accent/70',
        isActive && 'bg-sidebar-accent',
      )}
    >
      {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal" aria-hidden/>}
      <button
        type="button"
        data-navigate
        onClick={handleClick}
        aria-current={isActive ? 'page' : undefined}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="truncate text-sm" title={title}>{title}</p>
        <div className="flex min-w-0 items-center gap-2">
          {timeLabel && <span className="truncate text-xs tabular-nums text-muted-foreground">{timeLabel}</span>}
          <StatusBadge status={String(session.status)}/>
        </div>
      </button>
      {mounted ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
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
        <span className="size-6 shrink-0"/>
      )}
    </div>
  )
}
