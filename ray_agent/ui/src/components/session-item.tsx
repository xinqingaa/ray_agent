import {useCallback, useId, useRef} from 'react'
import {Link, useRouter} from '@/lib/navigation'
import {ArrowUpRight, Copy, MoreHorizontal, Pencil, Trash} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {copyText} from '@/lib/clipboard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {RunStatus, sidebarTitle} from '@/components/run/run-status'
import {useMounted} from '@/hooks/use-mounted'
import {useCompactingSessionId, useSessionWaitKind, type WaitKind} from '@/providers/sessions-provider'
import {cn, formatSidebarTime} from '@/lib/utils'
import type {Session} from '@/lib/api'

export type SessionRowAction = (session: Session, restoreFocus: () => void) => void

type SessionItemProps = {
  session: Session
  isActive: boolean
  onDelete: SessionRowAction
  onRename?: SessionRowAction
  /** 整行链接。目录页不传，只展示按下态，不离开当前页 */
  href?: string
  onClick?: (sessionId: string) => void
  /** 目录夹具直接标出压缩中；产品页由列表里的当前压缩会话决定 */
  showTime?: boolean
  compacting?: boolean
  /** 目录夹具直接标明等回复还是等批准；产品页用已打开会话记下的原因 */
  waitKind?: WaitKind | null
}

/** 会话一行：标题在左，时间或状态图标在右，未查看的完成结果在时间前加圆点。悬停时操作为时间让位。 */
export function SessionItem({session, isActive, onClick, onDelete, onRename, href, compacting: compactingProp, showTime = true, waitKind: waitKindProp}: SessionItemProps) {
  const mounted = useMounted()
  const router = useRouter()
  const statusId = useId()
  const row = useRef<HTMLElement>(null)
  const nextAction = useRef<(() => void) | null>(null)
  const listedCompacting = useCompactingSessionId()
  const rememberedWait = useSessionWaitKind(session.session_id)
  const compacting = compactingProp || listedCompacting === session.session_id
  const waitKind = waitKindProp === undefined ? rememberedWait : waitKindProp

  const handleSelect = useCallback(() => {
    onClick?.(session.session_id)
  }, [onClick, session.session_id])

  const restoreFocus = () => row.current?.focus({preventScroll: true})
  const title = session.title || '新任务'
  // 右键菜单与「更多」菜单共用这一份定义；没有对应动作的项不出现
  const actions: MenuEntry[] = [
    ...(href || onClick ? [menuItem('打开', ArrowUpRight, () => {handleSelect(); if (href) router.push(href)})] : []),
    ...(onRename ? [menuItem('重命名', Pencil, () => onRename(session, restoreFocus))] : []),
    menuItem('复制标题', Copy, () => copyText(title)),
    {type: 'separator'},
    menuItem('删除', Trash, () => onDelete(session, restoreFocus), {destructive: true}),
  ]
  const unread = !isActive && session.status === 'completed' && (session.unread_message_count ?? 0) > 0
  const hint = sidebarTitle(title, session.status, waitKind, compacting, unread)
  const controlClass = cn(
    'absolute inset-0 z-0 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-sidebar-accent shadow-xs' : 'hover:bg-foreground/5',
  )

  return (
    <ContextMenuSurface items={actions} disabled={!mounted}><div className="group/session relative min-h-8">
      {href ? (
        <Link
          ref={node => {row.current = node}}
          href={href}
          data-navigate
          title={hint}
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
          ref={node => {row.current = node}}
          type="button"
          data-navigate
          title={hint}
          onClick={handleSelect}
          aria-current={isActive ? 'page' : undefined}
          aria-labelledby={statusId}
          className={controlClass}
        />
      )}
      <div className="session-row-content pointer-events-none relative z-10 flex min-h-8 items-center gap-2 pl-2">
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-has-[[aria-current=page]]/session:font-medium group-has-[[aria-current=page]]/session:text-foreground" dir="auto">{title}</p>
        <RunStatus
          place="sidebar"
          id={statusId}
          title={title}
          status={session.status}
          waitKind={waitKind}
          compacting={compacting}
          unread={unread}
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
              className="session-row-menu absolute top-1 right-1 z-20 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
              aria-label={`${title} 的操作`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-4" aria-hidden/>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" onCloseAutoFocus={event => {
            const run = nextAction.current
            if (!run) return
            nextAction.current = null
            event.preventDefault()
            run()
          }}>
            {actions.map((entry, index) => entry.type === 'separator'
              ? <DropdownMenuSeparator key={`separator-${index}`}/>
              : <DropdownMenuItem key={`${entry.label}-${index}`} variant={entry.destructive ? 'destructive' : 'default'}
                onSelect={() => {nextAction.current = entry.run}}><entry.icon aria-hidden/>{entry.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="absolute top-1 right-1 z-20 size-6"/>
      )}
    </div></ContextMenuSurface>
  )
}
