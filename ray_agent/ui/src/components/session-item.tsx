'use client'

import {useCallback, useId} from 'react'
import Link from 'next/link'
import {MoreHorizontal, Pencil, Trash} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {RunStatus} from '@/components/run/run-status'
import {useMounted} from '@/hooks/use-mounted'
import {useCompactingSessionId, useSessionWaitKind, type WaitKind} from '@/providers/sessions-provider'
import {cn, formatSidebarTime} from '@/lib/utils'
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
  /** 目录夹具直接标明等回复还是等批准；产品页优先用项目占用，其次用已打开会话记下的原因 */
  waitKind?: WaitKind | null
}

/** 会话一行：标题在左，时间或需要处理的状态在右。悬停时操作为时间让位。 */
export function SessionItem({session, isActive, onClick, onDelete, onRename, href, compacting: compactingProp, showTime = true, waitKind: waitKindProp}: SessionItemProps) {
  const mounted = useMounted()
  const statusId = useId()
  const listedCompacting = useCompactingSessionId()
  const rememberedWait = useSessionWaitKind(session.session_id)
  const compacting = compactingProp || listedCompacting === session.session_id
  const waitKind = waitKindProp === undefined ? rememberedWait : waitKindProp

  const handleSelect = useCallback(() => {
    onClick?.(session.session_id)
  }, [onClick, session.session_id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(session)
  }, [onDelete, session])

  const title = session.title || '新任务'
  const controlClass = cn(
    'absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/70',
  )

  return (
    <div className="group/session relative min-h-8">
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
          aria-labelledby={statusId}
          className={controlClass}
        />
      ) : (
        <button
          type="button"
          data-navigate
          title={title}
          onClick={handleSelect}
          aria-current={isActive ? 'page' : undefined}
          aria-labelledby={statusId}
          className={controlClass}
        />
      )}
      <div className="pointer-events-none relative z-10 flex min-h-8 items-center gap-2 pl-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{title}</p>
        <RunStatus
          place="sidebar"
          id={statusId}
          title={title}
          status={session.status}
          waitKind={waitKind}
          compacting={compacting}
          time={formatSidebarTime(session.latest_message_at)}
          showTime={showTime}
        />
      </div>
      {mounted ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="absolute top-1 right-1 z-20 text-muted-foreground opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
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
        <span className="absolute top-1 right-1 z-20 size-6"/>
      )}
    </div>
  )
}
