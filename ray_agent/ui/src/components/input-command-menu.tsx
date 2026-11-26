import {useId, useLayoutEffect, useRef, useState, type PointerEvent} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Info, Loader2, Plus} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {commandSearchFields, matchingCommands, type CommandContext, type InputCommand} from '@/lib/commands'
import {matchesCommandQuery, type TriggerChar} from '@/lib/slash-trigger'
import {cn} from '@/lib/utils'
import {Tooltip, TooltipTrigger, TooltipContent} from '@/components/ui/tooltip'
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem} from '@/components/ui/dropdown-menu'

const ROW_HEIGHT_REM = 2.25

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
  const description = availability.available ? command.description : availability.reason
  const label = !availability.available ? `${command.title}，不可用：${availability.reason}` : undefined
  return <div id={id} role="option" aria-selected={active} aria-disabled={!availability.available}
    aria-label={label} data-value={command.id} data-slot="command-item"
    onPointerMove={onPointerMove} onMouseDown={event => event.preventDefault()}
    onClick={() => {if (availability.available) onRun(command)}}
    style={{height: `${ROW_HEIGHT_REM}rem`}}
    className={cn('flex select-none items-center gap-2.5 rounded-[11px] px-1.5 text-sm',
      active && 'bg-accent text-accent-foreground', availability.available ? 'cursor-pointer' : 'text-muted-foreground')}>
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground',
      active && 'bg-card text-foreground shadow-(--paper-shadow)')} aria-hidden>
      <Icon className="size-4"/>
    </span>
    <span className="max-w-[55%] shrink-0 truncate font-medium">{command.title}</span>
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={description}>{description}</span>
    {command.activeTag && <span className="shrink-0 rounded-md bg-signal-soft px-1.5 py-0.5 text-xs text-signal">{command.activeTag}</span>}
    {command.id === 'plan' && context.planMode && <span className="shrink-0 rounded-md bg-signal-soft px-1.5 py-0.5 text-xs text-signal">已开启</span>}
  </div>
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
export function SlashCommandList({id, trigger = '/', query, presetCommands = [], extraCommands = [], context, activeId, keyboardStep = 0, onActiveIdChange, onRun}: {
  id?: string
  trigger?: TriggerChar
  query: string
  presetCommands?: InputCommand[]
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
  const visibleCommands = trigger === '/' ? matchingCommands('').filter(command => visibility.canShowCommand(command.id)) : []
  const commands = query ? visibleCommands.filter(command => matchesCommandQuery(query, commandSearchFields(command))) : visibleCommands
  const presets = presetCommands.filter(command => matchesCommandQuery(query, commandSearchFields(command)))
  const skills = extraCommands.filter(command => matchesCommandQuery(query, commandSearchFields(command)))
  // 以未筛选的条目数设置高度，简短列表贴合内容，输入查询时浮层保持稳定。
  const [listHeight] = useState(() => Math.min(19.5, (visibleCommands.length + presetCommands.length + extraCommands.length) * ROW_HEIGHT_REM +
    (Number(visibleCommands.length > 0) + Number(presetCommands.length > 0) + Number(extraCommands.length > 0)) * 1.75 + 0.5))
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
    const headingHeight = selected.parentElement?.firstElementChild?.clientHeight ?? 0
    if (item.top < viewport.top + headingHeight) list.scrollTop -= viewport.top + headingHeight - item.top
    else if (item.bottom > viewport.bottom) list.scrollTop += item.bottom - viewport.bottom
  }, [keyboardStep, activeId])
  const point = (id: string, event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const previous = lastPointer.current
    lastPointer.current = {x: event.clientX, y: event.clientY}
    if (previous ? previous.x === event.clientX && previous.y === event.clientY : !event.movementX && !event.movementY) return
    onActiveIdChange(id)
  }
  const sections = [
    ...(trigger === '/' ? [{label: '操作', items: commands}] : []),
    {label: '场景预设', items: presets},
    {label: 'Skill', items: skills},
  ].filter(group => group.items.length > 0)
  return <div className="flex max-h-(--radix-popover-content-available-height) min-h-0 flex-col">
    <div ref={listRef} id={id ?? listId} role="listbox" aria-label={trigger === '@' ? '场景预设和 Skill' : '命令、场景和 Skill'} data-slot="command-list"
      className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5 [scrollbar-width:thin]" style={{height: `${listHeight}rem`}}>
      {sections.length === 0 ? <p className="grid h-full place-items-center px-3 text-center text-meta text-muted-foreground">{trigger === '@' ? '没有匹配的场景或 Skill' : '没有匹配的命令、场景或 Skill'}</p> :
        sections.map(({label, items}) => (
          <div key={label} role="group" aria-label={label}>
            <p aria-hidden className="sticky top-0 z-10 flex h-7 items-end bg-popover px-2.5 pb-1 text-xs text-muted-foreground">{label}</p>
            {items.map(command => <CommandRow key={command.id} command={command} context={context} active={activeId === command.id}
              onPointerMove={event => point(command.id, event)} onRun={onRun}/>)}
          </div>
        ))}
    </div>
    <div className="flex shrink-0 items-center gap-x-3 border-t px-3 py-1.5 text-xs text-muted-foreground [&_kbd]:rounded [&_kbd]:bg-muted [&_kbd]:px-1 [&_kbd]:font-sans [@media(pointer:coarse)]:hidden" aria-hidden>
      <span className="inline-flex items-center gap-0.5"><kbd>↑</kbd><kbd>↓</kbd><span className="ml-1">选择</span></span>
      <span><kbd>↵</kbd> 确认</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>
  </div>
}
