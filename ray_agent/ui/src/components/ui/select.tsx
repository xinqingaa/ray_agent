import {useState, useRef, type Ref} from 'react'
import {Check, ChevronDown, type UiIcon} from '@/components/ui/icons'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'

function focusOption(option: HTMLButtonElement) {
  option.focus({preventScroll: true})
  const panel = option.parentElement?.parentElement
  if (!panel) return
  const row = option.getBoundingClientRect()
  const viewport = panel.getBoundingClientRect()
  panel.scrollTop += Math.min(0, row.top - viewport.top) + Math.max(0, row.bottom - viewport.bottom)
}

/** 与模型菜单一致的列表选择。触发器高度与 size-8 对齐。 */
export function Select({value, options, disabled = false, label, onChange, className, id, describedBy, displayValue, triggerRef, onCloseAutoFocus}: {
  value: string
  options: {id: string; label?: string; icon?: UiIcon}[]
  disabled?: boolean
  label: string
  onChange: (id: string) => void
  className?: string
  /** 有外部 label 时用来关联；此时不再用 aria-label 覆盖名称 */
  id?: string
  describedBy?: string
  displayValue?: string
  triggerRef?: Ref<HTMLButtonElement>
  onCloseAutoFocus?: (event: Event) => void
}) {
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find(option => option.id === value)
  const display = displayValue ?? current?.label ?? current?.id ?? value
  return (
    <Popover open={open} onOpenChange={next => {if (!disabled) setOpen(next)}}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={id ? undefined : label}
          aria-description={describedBy ? undefined : `当前 ${display}`}
          aria-describedby={describedBy}
          className={cn('mt-2 inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40', className)}
        >
          <span className="truncate">{display}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden/>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-1" onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => {
          const active = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
          if (!active) return
          event.preventDefault()
          focusOption(active)
        }}>
        <div ref={listRef} role="listbox" aria-label={label}
          onKeyDown={event => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
            if (!items.length) return
            event.preventDefault()
            const index = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
            const target = items[next]
            if (target) focusOption(target)
          }}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-label={option.icon ? option.label : undefined}
              title={option.icon ? option.label : undefined}
              aria-selected={option.id === value}
              onClick={() => {onChange(option.id); setOpen(false)}}
              className={cn('relative flex min-h-8 w-full items-center justify-between rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', option.id === value ? 'bg-muted font-medium' : 'hover:bg-muted/50', option.icon && 'justify-center')}
            >
              {option.icon ? <option.icon className="size-4" aria-hidden/> : option.label ?? option.id}
              {option.id === value && <Check className={cn('size-4 shrink-0 text-signal', option.icon && 'absolute right-2')} aria-hidden/>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
