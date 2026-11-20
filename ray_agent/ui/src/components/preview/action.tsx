import type {UiIcon} from '@/components/ui/icons'
import type {MouseEventHandler} from 'react'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {cn} from '@/lib/utils'

export function PreviewAction({label, icon: Icon, onClick, disabled, pressed, className}: {
  label: string; icon: UiIcon; onClick: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; pressed?: boolean; className?: string
}) {
  return <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Button type="button" variant="ghost" size="icon-sm"
    aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
    className={cn('text-muted-foreground', pressed && 'bg-muted text-foreground', className)}><Icon className="size-4" aria-hidden/></Button></span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
