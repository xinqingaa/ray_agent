import {useLayoutEffect, useRef, useState} from 'react'
import {ChevronsRight, Finder, FolderPlus, Plus, type UiIcon} from '@/components/ui/icons'
import {IconAction} from '@/components/ui/icon-action'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {cn} from '@/lib/utils'

export const TOOLBAR_ACTION_SIZE = 28
export const TOOLBAR_ACTION_GAP = 2
export const TOOLBAR_OVERFLOW_WIDTH = 28

/**
 * 计算可用宽度下可直接展示的操作数量。
 * 全部放得下时返回总数（不显示溢出入口）；放不下时为右侧「>>」溢出按钮预留空间，
 * 展示尽量多的前几项，其余收进溢出菜单。
 */
export function visibleToolbarActionCount(
  total: number,
  availableWidth: number | null,
  itemWidth = TOOLBAR_ACTION_SIZE,
  gap = TOOLBAR_ACTION_GAP,
  triggerWidth = TOOLBAR_OVERFLOW_WIDTH,
): number {
  if (total <= 0) return 0
  if (availableWidth == null || !Number.isFinite(availableWidth)) return total
  const fullWidth = total * itemWidth + (total - 1) * gap
  if (availableWidth >= fullWidth) return total
  return Math.max(0, Math.min(total - 1, Math.floor((availableWidth - triggerWidth) / (itemWidth + gap))))
}

type ToolbarAction = {
  id: string
  label: string
  menuLabel: string
  icon: UiIcon
  disabled?: boolean
  onClick: () => void
}

/** 文件夹面板头部的操作：添加文件、新建文件夹（都放进所选目录，没有选择时是根目录）与在系统中显示。 */
export function FolderToolbarActions({directory, adding, onAdd, onNewFolder, revealLabel, onReveal, collapsible = false}: {
  directory: string
  adding?: boolean
  onAdd?: () => void
  onNewFolder?: () => void
  revealLabel: string
  onReveal?: () => void
  /** 嵌在右侧面板顶栏时按剩余宽度自适应收拢，溢出图标收进半透明「>>」菜单。 */
  collapsible?: boolean
}) {
  const items: ToolbarAction[] = []
  if (onAdd) {
    items.push({
      id: 'add',
      label: `${adding ? '正在添加文件到' : '添加文件到'}「${directory}」`,
      menuLabel: adding ? '正在添加文件…' : '添加文件',
      icon: Plus,
      disabled: adding,
      onClick: onAdd,
    })
  }
  if (onNewFolder) {
    items.push({
      id: 'new-folder',
      label: `在「${directory}」中新建文件夹`,
      menuLabel: '新建文件夹',
      icon: FolderPlus,
      onClick: onNewFolder,
    })
  }
  if (onReveal) {
    items.push({
      id: 'reveal',
      label: revealLabel,
      menuLabel: revealLabel,
      icon: Finder,
      onClick: onReveal,
    })
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const actionTriggered = useRef(false)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const itemCount = items.length

  useLayoutEffect(() => {
    if (!collapsible || itemCount === 0) return
    const node = containerRef.current
    if (!node) return
    const measure = () => {
      const parent = node.parentElement
      const barWidth = parent?.parentElement?.clientWidth || parent?.clientWidth || 0
      const width = node.clientWidth
      if (barWidth <= 0 && width <= 0) return
      setAvailableWidth(previous => (previous === width ? previous : width))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (node.parentElement) observer.observe(node.parentElement)
    return () => observer.disconnect()
  }, [collapsible, itemCount])

  if (itemCount === 0) return null

  const visibleCount = collapsible ? visibleToolbarActionCount(itemCount, availableWidth) : itemCount
  const visible = items.slice(0, visibleCount)
  const overflow = items.slice(visibleCount)

  return <div ref={containerRef} data-toolbar-overflow={overflow.length > 0 || undefined}
    className={cn('flex min-w-0 items-center justify-end gap-0.5', collapsible && 'w-full')}>
    {visible.map(item => {
      const Icon = item.icon
      return <IconAction key={item.id} label={item.label} disabled={item.disabled} onClick={item.onClick}
        className="size-7 shrink-0 text-muted-foreground">
        <Icon className="size-4" aria-hidden/>
      </IconAction>
    })}
    {overflow.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconAction label={`展开其余 ${overflow.length} 项操作`}
          className="inspector-toolbar-overflow size-7 shrink-0 text-muted-foreground/75 hover:text-foreground">
          <ChevronsRight className="size-4" aria-hidden/>
        </IconAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => {
        if (actionTriggered.current) {
          event.preventDefault()
          actionTriggered.current = false
        }
      }}>
        {overflow.map(item => {
          const Icon = item.icon
          return <DropdownMenuItem key={item.id} disabled={item.disabled} onSelect={() => {
            actionTriggered.current = true
            item.onClick()
          }}>
            <Icon aria-hidden/>{item.menuLabel}
          </DropdownMenuItem>
        })}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>
}
