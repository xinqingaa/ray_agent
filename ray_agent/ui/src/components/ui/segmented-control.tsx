import {useId} from 'react'
import type {UiIcon} from '@/components/ui/icons'
import {cn} from '@/lib/utils'

export function SegmentedControl<T extends string>({value, onValueChange, options, label, idPrefix, className, appearance = 'full'}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly {value: T; label: string; icon?: UiIcon}[]
  label: string
  idPrefix?: string
  className?: string
  appearance?: 'full' | 'icons'
}) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  const index = options.findIndex(option => option.value === value)
  return (
    <div role="tablist" aria-label={label} className={cn('relative isolate shrink-0 rounded-xl bg-muted p-0.5', appearance === 'icons' ? 'flex gap-0.5' : 'grid', className)}
      style={appearance === 'full' ? {gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`} : undefined}>
      {appearance === 'full' && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0.5 left-0.5 -z-10 rounded-[10px] bg-card shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${Math.max(0, index) * 100}%)`}}/>}
      {options.map((option, optionIndex) => {
        const Icon = option.icon
        const selected = value === option.value
        return <button key={option.value} type="button" role="tab" id={`${prefix}-${option.value}`} title={option.label} aria-label={option.label} aria-selected={selected} aria-controls={idPrefix ? `${idPrefix}-panel-${option.value}` : undefined} tabIndex={selected ? 0 : -1}
          onClick={() => onValueChange(option.value)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (optionIndex + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length
            onValueChange(options[next].value)
            document.getElementById(`${prefix}-${options[next].value}`)?.focus()
          }}
          className={cn('flex min-h-8 items-center justify-center whitespace-nowrap rounded-[10px] text-meta outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            appearance === 'icons' ? 'px-2' : 'gap-1.5 px-2.5', selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            appearance === 'icons' && selected && 'bg-background shadow-xs')}>
          {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true"/> : null}
          <span className={cn(appearance === 'icons' && Icon && 'overflow-hidden transition-[max-width,opacity,margin] duration-200',
            appearance === 'icons' && Icon && (selected ? 'ml-1.5 max-w-20 opacity-100' : 'max-w-0 opacity-0'))}>{option.label}</span>
        </button>
      })}
    </div>
  )
}
