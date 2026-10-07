'use client'

import {useId, useRef, useState} from 'react'
import {cn} from '@/lib/utils'

/** 离散档位滑块。刻度不可聚焦，滑块是唯一 tab stop。 */
export function DiscreteSlider({options, value, disabled = false, label = '思考强度', onChange}: {
  options: {id: string}[]
  value: string
  disabled?: boolean
  label?: string
  onChange: (id: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{origin: number; active: boolean} | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const descId = useId()
  const index = Math.max(0, options.findIndex(option => option.id === value))
  const max = Math.max(0, options.length - 1)
  const pct = max === 0 ? 0 : (index / max) * 100
  function move(next: number) {
    const id = options[Math.min(max, Math.max(0, next))]?.id
    if (id) onChange(id)
  }
  function indexAt(clientX: number) {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || max === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(ratio * max)
  }
  const motion = dragging ? 'transition-none' : 'transition-[left,width] duration-200 ease-out motion-reduce:transition-none'
  const scale = options.map(option => option.id).join('、')
  return <div className="mt-3">
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={disabled ? undefined : 0}
      aria-valuemax={disabled ? undefined : max}
      aria-valuenow={disabled ? undefined : index}
      aria-valuetext={disabled ? '思考已关闭' : value}
      aria-disabled={disabled || undefined}
      aria-describedby={descId}
      onKeyDown={event => {
        if (disabled) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {event.preventDefault(); move(index + 1)}
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {event.preventDefault(); move(index - 1)}
        else if (event.key === 'Home') {event.preventDefault(); move(0)}
        else if (event.key === 'End') {event.preventDefault(); move(max)}
      }}
      onPointerDown={event => {
        if (disabled) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {origin: event.clientX, active: false}
        move(indexAt(event.clientX))
      }}
      onPointerMove={event => {
        const current = drag.current
        if (!current) return
        if (!current.active && Math.abs(event.clientX - current.origin) > 3) {
          current.active = true
          setDragging(true)
        }
        move(indexAt(event.clientX))
      }}
      onPointerUp={() => {drag.current = null; setDragging(false)}}
      onPointerCancel={() => {drag.current = null; setDragging(false)}}
      className={cn('relative flex h-6 touch-none items-center px-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring', disabled ? 'cursor-default opacity-40' : 'cursor-pointer')}
    >
      <div ref={trackRef} className="relative h-full w-full">
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border"/>
        <span className={cn('absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-signal', motion)} style={{width: `${pct}%`}}/>
        <span className={cn('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-signal', motion)} style={{left: `${pct}%`}}/>
      </div>
    </div>
    <div aria-hidden className="flex justify-between gap-1 px-[7px]">{options.map(option => <span key={option.id} className={cn('min-h-8 px-1 text-xs leading-8', !disabled && value === option.id ? 'font-semibold text-signal' : 'text-muted-foreground')}>{option.id}</span>)}</div>
    <p id={descId} className="sr-only">档位 {scale}</p>
  </div>
}
