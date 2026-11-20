import type {ComponentProps} from 'react'
import {DropdownMenuContent, DropdownMenuLabel} from '@/components/ui/dropdown-menu'

export function TopbarMenuContent({title, children, ...props}: ComponentProps<typeof DropdownMenuContent> & {title: string}) {
  return <DropdownMenuContent align="end" sideOffset={7} collisionPadding={10} {...props}
    className="topbar-menu w-64 max-w-[calc(100vw-1.25rem)] animate-none! rounded-xl bg-background p-1.5 shadow-(--float-shadow)">
    <DropdownMenuLabel className="truncate px-2.5 pt-1.5 pb-2 text-xs font-medium text-muted-foreground" title={title}>
      {title}
    </DropdownMenuLabel>
    {children}
  </DropdownMenuContent>
}
