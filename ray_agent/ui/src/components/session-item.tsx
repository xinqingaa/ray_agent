'use client'

import {useCallback} from 'react'
import Link from 'next/link'
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
  onDelete: (session: Session) => void
  onRename?: (session: Session) => void
  /** 整行链接。目录页不传，只展示按下态，不离开当前页 */
  href?: string
  onClick?: (sessionId: string) => void
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
export function SessionItem({session, isActive, onClick, onDelete, onRename, href}: SessionItemProps) {
  const mounted = useMounted()

  const handleSelect = useCallback(() => {
    onClick?.(session.session_id)
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
  const accessibleName = `${title}，${status.label}`
  const controlClass = cn(
    'absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/70',
  )

  return (
    <div className="group/session relative">
      {isActive && <span className={cn('pointer-events-none absolute inset-y-1.5 left-0 z-10 w-0.5 rounded-full', status.className)} aria-hidden/>}
      <Tooltip>
        <TooltipTrigger asChild>
          {href ? (
            <Link
              href={href}
              data-navigate
              prefetch={false}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
                handleSelect()
              }}
              onKeyDown={(event) => {
                if (event.key !== ' ') return
                event.preventDefault()
                event.currentTarget.click()
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={accessibleName}
              className={controlClass}
            />
          ) : (
            <button
              type="button"
              data-navigate
              onClick={handleSelect}
              aria-current={isActive ? 'page' : undefined}
              aria-label={accessibleName}
              className={controlClass}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>{status.label}</TooltipContent>
      </Tooltip>
      <div className="pointer-events-none relative z-10 py-2.5 pr-1.5 pl-2.5">
        <p className="truncate pr-7 text-sm leading-5" dir="auto" title={title}>{title}</p>
        {timeLabel && <span className="block min-w-0 truncate text-xs tabular-nums text-muted-foreground">{timeLabel}</span>}
      </div>
      {mounted ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="absolute top-1.5 right-1 z-20 text-muted-foreground opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
              aria-label={`${title} 的操作`}
              onClick={(event) => event.stopPropagation()}
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
        <span className="absolute top-1.5 right-1 z-20 size-6"/>
      )}
    </div>
  )
}
