'use client'

import {useState} from 'react'
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
import {matchingCommands, type CommandContext, type InputCommand} from '@/lib/commands'
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
      className={cn('items-start py-2', !availability.available && 'text-muted-foreground')}
    >
      <Icon className="mt-0.5 size-4"/>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{command.title}</span>
        <span className="block truncate text-meta text-muted-foreground">
          {availability.available ? command.description : (
            <>
              <span className="sr-only">不可用，</span>
              {availability.reason}
            </>
          )}
        </span>
      </span>
      <span className="shrink-0 font-mono text-meta text-faint">/{command.keyword}</span>
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
  context,
  activeId,
  onActiveIdChange,
  onRun,
}: {
  query: string
  context: CommandContext
  activeId: string | null
  onActiveIdChange: (id: string) => void
  onRun: (command: InputCommand) => void
}) {
  const {visibility} = useDeveloperMode()
  const items = matchingCommands(query, {projectsEnabled: context.projectsEnabled}).filter(command => visibility.canShowCommand(command.id))
  return (
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
          <CommandGroup>
            {items.map((command) => (
              <CommandRow key={command.id} command={command} context={context} onRun={onRun}/>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
