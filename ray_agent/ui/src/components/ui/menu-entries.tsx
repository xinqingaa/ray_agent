import {DropdownMenuItem, DropdownMenuSeparator} from '@/components/ui/dropdown-menu'
import type {MenuEntry} from '@/lib/context-menu-policy'
import {toast} from 'sonner'

/**
 * 把右键菜单的同一份项定义渲染成「更多」下拉菜单的项。
 * 项的执行与右键菜单一致：失败时以提示显示。
 */
export function MenuEntryItems({entries}: {entries: MenuEntry[]}) {
  return <>
    {entries.map((entry, index) => entry.type === 'separator'
      ? <DropdownMenuSeparator key={`separator-${index}`}/>
      : <DropdownMenuItem key={`${entry.label}-${index}`} variant={entry.destructive ? 'destructive' : 'default'} disabled={entry.disabled}
        onSelect={() => {
          void Promise.resolve().then(() => entry.run()).catch(error => toast.error(error instanceof Error ? error.message : '操作失败，请重试'))
        }}><entry.icon aria-hidden/>{entry.label}</DropdownMenuItem>)}
  </>
}
