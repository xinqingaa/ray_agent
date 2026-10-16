'use client'

import {useId, useLayoutEffect, useRef, useState, type PointerEvent} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Info, Loader2, Plus} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {ContextRingGlyph} from '@/components/run/context-ring'
import {commandSearchFields, matchingCommands, type CommandContext, type InputCommand} from '@/lib/commands'
import {matchesCommandQuery} from '@/lib/slash-trigger'
import {cn} from '@/lib/utils'
import {Tooltip, TooltipTrigger, TooltipContent} from '@/components/ui/tooltip'
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem} from '@/components/ui/dropdown-menu'


function CommandRow({command, context, active, onPointerMove, onRun}: {
  command: InputCommand
  context: CommandContext
  active: boolean
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onRun: (command: InputCommand) => void
}) {
  const id = useId()
  const availability = command.available(context)
  const Icon = command.icon
  const compact = command.id === 'compact'
  const label = !availability.available ? `${command.title}，不可用：${availability.reason}` : command.title
  const row = <div id={id} role="option" aria-selected={active} aria-disabled={!availability.available}
    aria-label={!availability.available ? label : undefined} data-value={command.id} data-slot="command-item"
    onPointerMove={onPointerMove} onMouseDown={event => event.preventDefault()}
    onClick={() => {if (availability.available) onRun(command)}}
    className={cn('flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm', active && 'bg-accent text-accent-foreground', !availability.available && 'text-muted-foreground')}>
    <Icon className="size-4 shrink-0 text-muted-foreground"/>
    <span className="max-w-[55%] shrink-0 truncate font-medium">{command.title}</span>
    <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
      {compact ? <ContextRingGlyph usage={context.contextUsage}/> : availability.available ? command.description : <><span className="sr-only">不可用，</span>{availability.reason}</>}
    </span>
  </div>
  return !availability.available ? <Tooltip><TooltipTrigger asChild>{row}</TooltipTrigger><TooltipContent>{availability.reason}</TooltipContent></Tooltip> : row
}

export function PlusCommandMenu({context}: {context: CommandContext}) {
  const {visibility} = useDeveloperMode()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const items = matchingCommands('', undefined, 'plus').filter(command => visibility.canShowCommand(command.id))
  return (
    <DropdownMenu open={open} onOpenChange={(next) => {setOpen(next); setReason(null)}}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label="命令菜单" aria-busy={context.uploading}>
          {context.uploading ? <Loader2 className="size-4 animate-spin"/> : <Plus/>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48 max-w-[14rem]">
        {items.map((command) => {
          const state = command.available(context)
          const Icon = command.icon
          return (
            <Tooltip key={command.id}>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  aria-disabled={!state.available}
                  aria-label={state.available ? command.title : `${command.title}，不可用：${state.reason}`}
                  className={cn(!state.available && 'text-muted-foreground')}
                  onSelect={(event) => {
                    if (!state.available) {event.preventDefault(); setReason(state.reason); return}
                    command.run(context); setOpen(false)
                  }}
                >
                  <Icon/><span className="flex-1">{command.title}</span>
                  {!state.available && <Info className="size-3.5" aria-hidden/>}
                </DropdownMenuItem>
              </TooltipTrigger>
              {!state.available && <TooltipContent>{state.reason}</TooltipContent>}
            </Tooltip>
          )
        })}
        {reason && <p role="status" className="px-2 py-2 text-meta text-muted-foreground">{reason}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 鼠标只改高亮；键盘导航才允许调整列表内部的可视位置。 */
export function SlashCommandList({query, extraCommands = [], context, activeId, keyboardStep = 0, onActiveIdChange, onRun}: {
  query: string
  extraCommands?: InputCommand[]
  context: CommandContext
  activeId: string | null
  keyboardStep?: number
  onActiveIdChange: (id: string) => void
  onRun: (command: InputCommand) => void
}) {
  const {visibility} = useDeveloperMode()
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const seenKeyboardStep = useRef(keyboardStep)
  const lastPointer = useRef<{x: number; y: number} | null>(null)
  const commands = matchingCommands(query).filter(command => visibility.canShowCommand(command.id))
  const skills = extraCommands.filter(command => matchesCommandQuery(query, commandSearchFields(command)))
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query])
  useLayoutEffect(() => {
    if (keyboardStep === seenKeyboardStep.current) return
    seenKeyboardStep.current = keyboardStep
    const list = listRef.current
    if (!list || !activeId) return
    const selected = list.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(activeId)}"]`)
    if (!selected) return
    const viewport = list.getBoundingClientRect(), item = selected.getBoundingClientRect()
    if (item.top < viewport.top) list.scrollTop -= viewport.top - item.top
    else if (item.bottom > viewport.bottom) list.scrollTop += item.bottom - viewport.bottom
  }, [keyboardStep, activeId])
  const point = (id: string, event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const previous = lastPointer.current
    lastPointer.current = {x: event.clientX, y: event.clientY}
    if (previous ? previous.x === event.clientX && previous.y === event.clientY : !event.movementX && !event.movementY) return
    onActiveIdChange(id)
  }
  return <div ref={listRef} id={listId} role="listbox" aria-label="命令" data-slot="command-list"
    className="h-[min(20rem,var(--radix-popover-content-available-height,20rem))] overflow-y-auto overscroll-contain p-2">
    {commands.length + skills.length === 0 ? <p className="py-4 text-center text-meta text-muted-foreground">没有匹配的命令</p> : <>
      {commands.length > 0 && <div role="group" aria-label="命令"><p aria-hidden className="px-2 py-1.5 text-xs text-muted-foreground">命令</p>{commands.map(command => <CommandRow key={command.id} command={command} context={context} active={activeId === command.id} onPointerMove={event => point(command.id, event)} onRun={onRun}/>)}</div>}
      {skills.length > 0 && <div role="group" aria-label="Skills" className={cn(commands.length > 0 && 'mt-2')}><p aria-hidden className="px-2 py-1.5 text-xs text-muted-foreground">Skills</p>{skills.map(command => <CommandRow key={command.id} command={command} context={context} active={activeId === command.id} onPointerMove={event => point(command.id, event)} onRun={onRun}/>)}</div>}
    </>}
  </div>
}
