'use client'

import type {ComponentProps} from 'react'
import {Button} from './button'
import {Tooltip, TooltipContent, TooltipTrigger} from './tooltip'

/** 工具栏操作统一尺寸、悬停提示与无障碍名称。 */
export function IconAction({label, children, ...props}: Omit<ComponentProps<typeof Button>, 'size'> & {label: string}) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} title={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
