/**
 * 全应用右键策略（纯判断，不含界面）。
 *
 * 规则：任何位置都不出现 WebView 原生菜单。表面（`ContextMenuSurface`）在 React 事件中接管并停止冒泡，
 * 没有表面接管的事件冒泡到 window 后，只按可编辑区域与选中文字生成编辑菜单；其余区域什么也不做。
 * 菜单项的执行由 context-menu.tsx 的宿主在关闭菜单、恢复焦点之后进行。
 */
import {ClipboardPaste, Copy, Scissors, TextSelect, type UiIcon} from '@/components/ui/icons'
import {copyText, readClipboard} from '@/lib/clipboard'
import {captureSelection, editTargetOf, insertText, selectAllText, selectedTextOf, type EditTarget} from '@/lib/text-edit'

export type MenuPoint = {x: number; y: number}

export type MenuItem = {
  type: 'item'
  label: string
  icon: UiIcon
  /** 菜单关闭、焦点恢复之后执行。抛出的错误由宿主以提示显示。 */
  run: () => void | Promise<void>
  disabled?: boolean
  destructive?: boolean
}

export type MenuEntry = MenuItem | {type: 'separator'}

/** 编辑菜单的结果：菜单项，以及关闭后把焦点与选区放回原处的函数。 */
export type EditingMenu = {entries: MenuEntry[]; restore: (() => void) | null}

export function menuItem(label: string, icon: UiIcon, run: MenuItem['run'], extra: Partial<MenuItem> = {}): MenuItem {
  return {type: 'item', label, icon, run, ...extra}
}

/** 删掉开头、结尾和连续的分隔线；只在两组都有内容时保留中间的分隔。 */
export function tidyEntries(entries: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'separator') {
      if (result.length && result[result.length - 1].type !== 'separator') result.push(entry)
    } else {
      result.push(entry)
    }
  }
  while (result.length && result[result.length - 1].type === 'separator') result.pop()
  return result
}

/** 事件的菜单位置。键盘触发的 contextmenu 没有坐标，取目标底边中点。 */
export function menuPointOf(event: MouseEvent | {clientX: number; clientY: number; target: EventTarget | null}): MenuPoint {
  if (event.clientX || event.clientY) return {x: event.clientX, y: event.clientY}
  const rect = event.target instanceof Element ? event.target.getBoundingClientRect() : null
  return rect ? {x: rect.left + rect.width / 2, y: rect.bottom} : {x: 0, y: 0}
}

/** 宿主自己的菜单（锚点与打开的菜单）上的事件不再生成新菜单。 */
export function isMenuHostTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-context-menu-anchor], [role="menu"]') !== null
}

/** 文档级选区里，点在选中文字上的部分（位置落在选区矩形内）。 */
function documentSelectionAt(target: EventTarget | null, point: MenuPoint): string {
  if (!(target instanceof Node)) return ''
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return ''
  const text = selection.toString()
  if (!text) return ''
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index)
    if (!range.intersectsNode(target)) continue
    for (const rect of Array.from(range.getClientRects())) {
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return text
    }
  }
  return ''
}

/** 选区与整块区域（如一条回复）相交时的选中文字；没有选中文字返回空串。 */
export function selectedTextWithin(node: Node): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return ''
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(node)) return selection.toString()
  }
  return ''
}

/**
 * 编辑菜单：可编辑区域给出剪切、复制、粘贴、全选（只读只给复制与全选，无选区不给剪切与复制）；
 * 非可编辑区域有选中文字时只给复制。两者都不适用时返回 null。
 */
export function editingMenuFor(target: EventTarget | null, point: MenuPoint): EditingMenu | null {
  const edit: EditTarget | null = editTargetOf(target)
  if (edit) {
    const selected = selectedTextOf(edit)
    const restore = captureSelection(edit)
    const primary: MenuEntry[] = []
    if (edit.writable && selected) primary.push(menuItem('剪切', Scissors, () => cutSelection(edit)))
    if (selected) primary.push(menuItem('复制', Copy, () => copyCurrentSelection(edit)))
    if (edit.writable) primary.push(menuItem('粘贴', ClipboardPaste, () => pasteClipboard(edit)))
    const secondary: MenuEntry[] = [menuItem('全选', TextSelect, () => selectAllText(edit))]
    return {entries: tidyEntries([...primary, {type: 'separator'}, ...secondary]), restore}
  }
  const text = documentSelectionAt(target, point)
  if (!text) return null
  return {entries: [menuItem('复制', Copy, () => copyText(text))], restore: null}
}

async function copyCurrentSelection(edit: EditTarget) {
  const selected = selectedTextOf(edit)
  if (selected) await copyText(selected)
}

async function cutSelection(edit: EditTarget) {
  const selected = selectedTextOf(edit)
  if (!selected) return
  await copyText(selected)
  insertText(edit, '')
}

async function pasteClipboard(edit: EditTarget) {
  const text = await readClipboard()
  if (!text) return
  if (!edit.element.isConnected) return
  insertText(edit, text)
}
