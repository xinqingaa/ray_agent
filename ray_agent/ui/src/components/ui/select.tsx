'use client'

import {useState} from 'react'
import {Check, ChevronDown} from 'lucide-react'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'

/** 与模型菜单一致的列表选择。触发器高度与 size-8 对齐。 */
export function Select({value, options, disabled = false, label, onChange, className, id, describedBy}: {
  value: string
  options: {id: string; label?: string}[]
  disabled?: boolean
  label: string
  onChange: (id: string) => void
  className?: string
  /** 有外部 label 时用来关联；此时不再用 aria-label 覆盖名称 */
  id?: string
  describedBy?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.id === value)
  return (
    <Popover open={open} onOpenChange={next => {if (!disabled) setOpen(next)}}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={id ? undefined : label}
          aria-describedby={describedBy}
          className={cn('mt-2 inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40', className)}
        >
          <span className="truncate">{current?.label ?? current?.id ?? value}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden/>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        <div role="listbox" aria-label={label}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => {onChange(option.id); setOpen(false)}}
              className={cn('flex min-h-8 w-full items-center justify-between rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', option.id === value ? 'bg-muted font-medium' : 'hover:bg-muted/50')}
            >
              {option.label ?? option.id}
              {option.id === value && <Check className="size-4 text-signal" aria-hidden/>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
