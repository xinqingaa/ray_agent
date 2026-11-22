/**
 * 菜单与右键菜单共用的浮层表面、阴影和条目尺寸（原型的 popover 表面：14px 圆角、浮层阴影）。
 * 打开时用快档缩放淡入，关闭同档收回；减少动态效果时不做动画。
 */
export const MENU_SURFACE = "bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-[14px] p-1.5 shadow-(--float-shadow) duration-(--motion-fast) ease-(--motion-ease) data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none"

export const MENU_ITEM = "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex h-8 cursor-default items-center gap-2 rounded-[9px] px-2.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/** 菜单内的分隔线，与条目共用左右留白。 */
export const MENU_SEPARATOR = "bg-border -mx-1.5 my-1.5 h-px"
