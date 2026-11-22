/**
 * 右键菜单的统一接入方式。
 *
 * - `ContextMenuProvider` 挂在应用根部，只有一个菜单宿主，负责浮层、焦点恢复与菜单项执行，并接管未被表面处理的右键。
 * - `ContextMenuSurface` 包住一个有明确对象的区域（会话行、文件树、输入框等）。它在 React 事件里接管右键并停止冒泡，
 *   所以嵌套时取最内层表面。`items` 为表面自己的菜单项；`includeEditing` 为真时，可编辑区域在表面菜单后追加编辑项。
 *
 * 示例：
 *   <ContextMenuSurface items={[menuItem('复制链接', Link2, () => copyText(url))]}>
 *     <a href={url}>…</a>
 *   </ContextMenuSurface>
 */
import {forwardRef, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode} from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import {Slot} from '@radix-ui/react-slot'
import {toast} from 'sonner'
import {cn} from '@/lib/utils'
import {
  editingMenuFor,
  isMenuHostTarget,
  menuItem,
  menuPointOf,
  tidyEntries,
  type MenuEntry,
  type MenuItem,
  type MenuPoint,
} from '@/lib/context-menu-policy'
import {MENU_ITEM, MENU_SEPARATOR, MENU_SURFACE} from './menu-styles'

export {menuItem, type MenuEntry, type MenuPoint}

type MenuRequest = {
  id: number
  point: MenuPoint
  entries: MenuEntry[]
  restore: (() => void) | null
}

let opener: ((request: Omit<MenuRequest, 'id'>) => void) | null = null
let nextRequestId = 0

/**
 * 在指定位置打开菜单。菜单项在关闭并恢复焦点后执行。没有挂载宿主时不做任何事。
 * `restore` 为关闭后要恢复的焦点与选区；省略时菜单不改变焦点。
 */
export function openContextMenu(request: {point: MenuPoint; entries: MenuEntry[]; restore?: (() => void) | null}) {
  const entries = tidyEntries(request.entries)
  if (!entries.length) return
  opener?.({point: request.point, entries, restore: request.restore ?? null})
}

/**
 * 捕获阶段兜底：任何位置的右键都先取消原生菜单，即使中途有组件 stopPropagation 也不会漏出。
 * 只取消默认行为，不生成菜单、不阻止传播。宿主自己的锚点事件除外，Radix 的触发器需要读取未取消的事件。
 */
function preventNativeContextMenu(event: MouseEvent) {
  if (isMenuHostTarget(event.target)) return
  event.preventDefault()
}

/** 没有表面接管的右键：只按可编辑区域与选中文字生成菜单，其余区域什么也不做。原生菜单始终被阻止。 */
function handleUnclaimedContextMenu(event: MouseEvent) {
  event.preventDefault()
  if (isMenuHostTarget(event.target)) return
  const point = menuPointOf(event)
  const menu = editingMenuFor(event.target, point)
  if (menu) openContextMenu({point, entries: menu.entries, restore: menu.restore})
}

async function runMenuAction(run: (() => void | Promise<void>) | null) {
  if (!run) return
  try {
    await run()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '操作失败，请重试')
  }
}

export function ContextMenuProvider({children}: {children: ReactNode}) {
  const [request, setRequest] = useState<MenuRequest | null>(null)
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  // 所选项先记下，等菜单关闭并恢复焦点后再执行。用 ref 保证关闭回调读到的一定是最新的所选项。
  const pending = useRef<MenuItem['run'] | null>(null)
  // 最新一次打开的菜单。被新菜单替换的旧菜单关闭时不再恢复焦点，避免抢走新菜单的焦点。
  const latestId = useRef(0)

  useEffect(() => {
    opener = next => {
      const id = ++nextRequestId
      latestId.current = id
      setRequest({...next, id})
    }
    return () => {opener = null}
  }, [])

  useEffect(() => {
    window.addEventListener('contextmenu', preventNativeContextMenu, true)
    window.addEventListener('contextmenu', handleUnclaimedContextMenu)
    return () => {
      window.removeEventListener('contextmenu', preventNativeContextMenu, true)
      window.removeEventListener('contextmenu', handleUnclaimedContextMenu)
    }
  }, [])

  // Radix 只在锚点收到 contextmenu 时打开，并以事件坐标定位；这里用一次合成事件驱动它。
  useEffect(() => {
    if (!request || !anchor) return
    anchor.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: request.point.x, clientY: request.point.y}))
  }, [request, anchor])

  return <>
    {children}
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <span ref={setAnchor} data-context-menu-anchor aria-hidden="true" className="pointer-events-none"
          style={{position: 'fixed', left: request?.point.x ?? 0, top: request?.point.y ?? 0, width: 0, height: 0}}/>
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        {request && <ContextMenuPrimitive.Content key={request.id} data-slot="context-menu-content" collisionPadding={8}
          className={cn(MENU_SURFACE, 'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)')}
          onCloseAutoFocus={event => {
            // 焦点由宿主恢复到打开菜单前的位置，再执行所选项，使对话框等后续界面以正确的焦点起点出现。
            event.preventDefault()
            if (request.id === latestId.current) request.restore?.()
            const run = pending.current
            pending.current = null
            void runMenuAction(run)
          }}>
          {request.entries.map((entry, index) => entry.type === 'separator'
            ? <ContextMenuPrimitive.Separator key={`separator-${index}`} className={MENU_SEPARATOR}/>
            : <ContextMenuPrimitive.Item key={`${entry.label}-${index}`} data-slot="context-menu-item" className={MENU_ITEM}
              disabled={entry.disabled} data-variant={entry.destructive ? 'destructive' : 'default'}
              onSelect={() => {pending.current = entry.run}}>
              <entry.icon aria-hidden/>{entry.label}
            </ContextMenuPrimitive.Item>)}
        </ContextMenuPrimitive.Content>}
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  </>
}

function focusPrevious(): () => void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // 已打开的菜单项不是可以恢复的焦点，换菜单时沿用更早的焦点位置。
  const previous = active && !active.closest('[role="menu"]') ? active : null
  return () => {if (previous?.isConnected) previous.focus({preventScroll: true})}
}

function isMenuKey(event: ReactKeyboardEvent<HTMLElement>) {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
}

export type ContextMenuSurfaceProps = {
  /**
   * 表面自己的菜单项。函数形式按右键目标计算（例如依赖选中文字）。
   * 没有菜单项时表面不接管，事件交给外层表面或未接管处理。
   */
  items?: MenuEntry[] | ((target: EventTarget | null) => MenuEntry[])
  /** 为真时，可编辑区域在表面菜单后追加剪切、复制、粘贴、全选 */
  includeEditing?: boolean
  /** 为真时不接管右键，事件交给外层表面或未接管处理 */
  disabled?: boolean
  children: ReactElement
}

/** 包住一个区域并提供菜单。接管的右键会停止冒泡，因此嵌套时取最内层；没有菜单项的表面透明。 */
export const ContextMenuSurface = forwardRef<HTMLElement, ContextMenuSurfaceProps>(function ContextMenuSurface({
  items = [],
  includeEditing = false,
  disabled = false,
  children,
}, ref) {
  const menuFor = (target: EventTarget | null, point: MenuPoint) => {
    const own = typeof items === 'function' ? items(target) : items
    const editing = includeEditing ? editingMenuFor(target, point) : null
    const entries = tidyEntries([...own, ...(editing ? [{type: 'separator'} as const, ...editing.entries] : [])])
    return entries.length ? {entries, restore: editing?.restore ?? focusPrevious()} : null
  }
  return <Slot ref={ref} data-slot="context-menu-surface"
    onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
      if (disabled) return
      const point = menuPointOf(event.nativeEvent)
      const menu = menuFor(event.target, point)
      if (!menu) return
      event.preventDefault()
      event.stopPropagation()
      openContextMenu({point, entries: menu.entries, restore: menu.restore})
    }}
    onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled || event.defaultPrevented || !isMenuKey(event)) return
      // 键盘没有坐标：菜单贴着目标底边中点打开
      const point = menuPointOf({clientX: 0, clientY: 0, target: event.target})
      const menu = menuFor(event.target, point)
      if (!menu) return
      event.preventDefault()
      event.stopPropagation()
      openContextMenu({point, entries: menu.entries, restore: menu.restore})
    }}>{children}</Slot>
})