'use client'

import {useLayoutEffect, useRef, useState} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Info, Loader2, Plus} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {commandSearchFields, matchingCommands, type CommandContext, type InputCommand} from '@/lib/commands'
import {matchesCommandQuery} from '@/lib/slash-trigger'
import {cn} from '@/lib/utils'
import {Tooltip, TooltipTrigger, TooltipContent} from '@/components/ui/tooltip'
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem} from '@/components/ui/dropdown-menu'


function CommandRow({
  command,
  context,
  onRun,
}: {
  command: InputCommand
  context: CommandContext
  onRun: (command: InputCommand) => void
}) {
  const availability = command.available(context)
  const Icon = command.icon
  return (
    <CommandItem
      value={command.id}
      onMouseDown={(event) => event.preventDefault()}
      onSelect={() => {
        if (!availability.available) return
        onRun(command)
      }}
      className={cn('rounded-lg px-3 py-2.5', !availability.available && 'text-muted-foreground')}
    >
      <Icon className="size-4"/>
      <span className="max-w-[55%] shrink-0 truncate font-medium">{command.title}</span>
      <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
        {availability.available ? command.description : <><span className="sr-only">不可用，</span>{availability.reason}</>}
      </span>
    </CommandItem>
  )
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

export function SlashCommandList({
  query,
  extraCommands = [],
  context,
  activeId,
  onActiveIdChange,
  onRun,
}: {
  query: string
  extraCommands?: InputCommand[]
  context: CommandContext
  activeId: string | null
  onActiveIdChange: (id: string) => void
  onRun: (command: InputCommand) => void
}) {
  const {visibility} = useDeveloperMode()
  const frameRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const heightReady = useRef(false)
  const commands = matchingCommands(query, {projectsEnabled: context.projectsEnabled}).filter(command => visibility.canShowCommand(command.id))
  const skills = extraCommands.filter(command => matchesCommandQuery(query, commandSearchFields(command)))
  const items = [...commands, ...skills]
  const heightKey = items.map(item => item.id).join('\n')
  useLayoutEffect(() => {
    const frame = frameRef.current
    const content = listRef.current
    if (!frame || !content) return
    const next = content.offsetHeight
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!heightReady.current || reduce) {
      heightReady.current = true
      frame.style.height = `${next}px`
      return
    }
    const prev = frame.getBoundingClientRect().height
    if (Math.abs(prev - next) < 1) return
    frame.style.height = `${prev}px`
    void frame.offsetHeight
    frame.style.height = `${next}px`
  }, [heightKey])
  useLayoutEffect(() => {
    const root = listRef.current
    if (!root || !activeId) return
    const reveal = () => {
      const list = root.querySelector<HTMLElement>('[data-slot="command-list"]')
      const selected = root.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(activeId)}"]`)
      if (!list || !selected) return
      const listBox = list.getBoundingClientRect()
      const itemBox = selected.getBoundingClientRect()
      if (itemBox.top < listBox.top) list.scrollTop -= listBox.top - itemBox.top
      else if (itemBox.bottom > listBox.bottom) list.scrollTop += itemBox.bottom - listBox.bottom
    }
    reveal()
    const frame = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(frame)
  }, [activeId, items.length, query])
  return (
    <div ref={frameRef} className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none">
    <div ref={listRef}>
    <Command
      shouldFilter={false}
      loop
      label="命令"
      value={activeId ?? ''}
      onValueChange={(id) => {
        if (id) onActiveIdChange(id)
      }}
    >
      <CommandList label="命令">
        {items.length === 0 ? (
          <CommandEmpty className="py-4 text-center text-meta text-muted-foreground">没有匹配的命令</CommandEmpty>
        ) : (
          <>
          <CommandGroup heading="命令" className="p-2">
            {commands.map((command) => (
              <CommandRow key={command.id} command={command} context={context} onRun={onRun}/>
            ))}
          </CommandGroup>
          {skills.length > 0 && <CommandGroup heading="Skills" className="p-2">{skills.map(command => <CommandRow key={command.id} command={command} context={context} onRun={onRun}/>)}</CommandGroup>}
          </>
        )}
      </CommandList>
    </Command>
    </div>
    </div>
  )
}
