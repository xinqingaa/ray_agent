import {useId, useRef} from 'react'
import type {UiIcon} from '@/components/ui/icons'
import {SegmentThumb, useSegmentThumb} from '@/components/ui/segment-thumb'
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
  const rootRef = useRef<HTMLDivElement>(null)
  const thumb = useSegmentThumb(rootRef, value, options.map(option => option.value).join('\u0000'))
  return (
    <div ref={rootRef} role="tablist" aria-label={label} data-segment-label-gap={appearance === 'icons' ? '6' : undefined}
      className={cn('relative isolate shrink-0 rounded-xl bg-muted p-0.5', appearance === 'icons' ? 'flex gap-0.5' : 'grid', className)}
      style={appearance === 'full' ? {gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`} : undefined}>
      <SegmentThumb thumb={thumb} className={cn('rounded-[10px]', appearance === 'full' ? 'bg-card shadow-xs' : 'bg-background shadow-xs')}/>
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
          className={cn('relative flex min-h-8 items-center justify-center whitespace-nowrap rounded-[10px] text-meta outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease) focus-visible:ring-2 focus-visible:ring-ring',
            appearance === 'icons' ? 'px-2' : 'gap-1.5 px-2.5', selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true"/> : null}
          {appearance === 'icons' && Icon ? (
            <span data-segment-label="" className={cn(
              'grid overflow-hidden transition-[grid-template-columns,opacity,margin] duration-(--motion-mid) ease-(--motion-ease) motion-reduce:transition-none',
              selected ? 'ml-1.5 grid-cols-[1fr] opacity-100' : 'ml-0 grid-cols-[0fr] opacity-0',
            )}>
              <span className="min-w-0 overflow-hidden">{option.label}</span>
            </span>
          ) : <span>{option.label}</span>}
        </button>
      })}
    </div>
  )
}
