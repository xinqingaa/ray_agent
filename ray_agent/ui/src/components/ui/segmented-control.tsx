'use client'

import {useId} from 'react'
import type {LucideIcon} from 'lucide-react'
import {cn} from '@/lib/utils'

export function SegmentedControl<T extends string>({value, onValueChange, options, label, idPrefix, className}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly {value: T; label: string; icon: LucideIcon}[]
  label: string
  idPrefix?: string
  className?: string
}) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  const index = options.findIndex(option => option.value === value)
  return (
    <div role="tablist" aria-label={label} className={cn('relative isolate grid shrink-0 rounded-md bg-muted p-0.5', className)} style={{gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`}}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0.5 left-0.5 -z-10 rounded-sm border border-border/60 bg-card shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${Math.max(0, index) * 100}%)`}}/>
      {options.map((option, optionIndex) => {
        const Icon = option.icon
        return <button key={option.value} type="button" role="tab" id={`${prefix}-${option.value}`} aria-selected={value === option.value} aria-controls={idPrefix ? `${idPrefix}-panel-${option.value}` : undefined} tabIndex={value === option.value ? 0 : -1}
          onClick={() => onValueChange(option.value)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (optionIndex + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length
            onValueChange(options[next].value)
            document.getElementById(`${prefix}-${options[next].value}`)?.focus()
          }}
          className={cn('flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-meta outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', value === option.value ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          <Icon className="size-3.5 shrink-0" aria-hidden="true"/>{option.label}
        </button>
      })}
    </div>
  )
}
