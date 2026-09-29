'use client'

import {useState} from 'react'
import {Loader2, Plus} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {matchingCommands, type CommandContext, type InputCommand} from '@/lib/commands'
import {cn} from '@/lib/utils'

const menuWidth = 'w-[min(20rem,calc(100vw-2rem))]'

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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const items = matchingCommands(query)

  const run = (command: InputCommand) => {
    command.run(context)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="cursor-pointer"
          aria-label="命令菜单"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-busy={context.uploading}
          title="命令菜单"
        >
          {context.uploading ? <Loader2 className="size-4 animate-spin"/> : <Plus/>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={8}
        className={cn(menuWidth, 'p-0')}
      >
        <Command shouldFilter={false} loop label="命令菜单">
          <CommandInput aria-label="搜索命令" placeholder="搜索命令" value={query} onValueChange={setQuery}/>
          <CommandList label="命令">
            {items.length === 0 ? (
              <CommandEmpty className="py-4 text-center text-meta text-muted-foreground">没有匹配的命令</CommandEmpty>
            ) : (
              <CommandGroup>
                {items.map((command) => (
                  <CommandRow key={command.id} command={command} context={context} onRun={run}/>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  const items = matchingCommands(query)
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
