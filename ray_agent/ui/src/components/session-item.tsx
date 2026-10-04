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
import {useMounted} from '@/hooks/use-mounted'
import {useCompactingSessionId} from '@/providers/sessions-provider'
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
  /** 目录夹具直接标出压缩中；产品页由列表里的当前压缩会话决定 */
  showTime?: boolean
  compacting?: boolean
}

const STATUS: Record<Session['status'], {label: string; textClass?: string}> = {
  pending: {label: '准备中', textClass: 'text-state-running'},
  running: {label: '运行中', textClass: 'text-state-running'},
  waiting: {label: '等你处理', textClass: 'text-state-waiting'},
  completed: {label: '已完成'},
  failed: {label: '失败', textClass: 'text-state-failed'},
  cancelled: {label: '已停止'},
  interrupted: {label: '已中断', textClass: 'text-state-interrupted'},
}

/** 会话列表项：选中用弱底和字重。需要处理的状态写在标题右侧；已完成和已停止不写。 */
export function SessionItem({session, isActive, onClick, onDelete, onRename, href, compacting: compactingProp, showTime = true}: SessionItemProps) {
  const mounted = useMounted()
  const listedCompacting = useCompactingSessionId()
  const compacting = compactingProp || listedCompacting === session.session_id

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
  const status = compacting ? {label: '压缩中', textClass: 'text-state-running'} : STATUS[session.status]
  const accessibleName = `${title}，${status.label}`
  const controlClass = cn(
    'absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/70',
  )

  return (
    <div className="group/session relative">
      {href ? (
        <Link
          href={href}
          data-navigate
          prefetch={false}
          title={title}
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
          title={title}
          onClick={handleSelect}
          aria-current={isActive ? 'page' : undefined}
          aria-label={accessibleName}
          className={controlClass}
        />
      )}
      <div className="pointer-events-none relative z-10 py-2.5 pr-8 pl-2.5">
        <div className="flex items-baseline gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-sm leading-5', isActive ? 'font-medium' : 'font-normal')} dir="auto">{title}</p>
          {status.textClass && <span className={cn('shrink-0 text-xs leading-5', status.textClass)}>{status.label}</span>}
        </div>
        {session.latest_message && <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">{session.latest_message}</p>}
        {showTime && timeLabel && <span className="block min-w-0 truncate text-xs font-normal tabular-nums text-muted-foreground">{timeLabel}</span>}
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
