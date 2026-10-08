'use client'

import {useId, useRef, useState} from 'react'
import {cn} from '@/lib/utils'

/** 圆点中心离轨道两端的距离。小于它时，圆角会把两端的圆点切成半圆。 */
const STOP_INSET = 10

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
  function stopLeft(i: number) {
    if (max === 0) return '50%'
    return `calc(${STOP_INSET}px + (100% - ${STOP_INSET * 2}px) * ${i / max})`
  }
  function move(next: number) {
    const id = options[Math.min(max, Math.max(0, next))]?.id
    if (id) onChange(id)
  }
  function indexAt(clientX: number) {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const inner = rect.width - STOP_INSET * 2
    if (inner <= 0 || max === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - STOP_INSET) / inner))
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
      className={cn('relative h-8 touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring', disabled ? 'cursor-default opacity-40' : 'cursor-pointer')}
    >
      <div ref={trackRef} className="absolute inset-x-3 top-1/2 h-3 -translate-y-1/2">
        <span className="absolute inset-0 rounded-full bg-muted"/>
        <span className={cn('absolute inset-y-0 left-0 rounded-full bg-signal', motion)} style={{width: stopLeft(index)}}/>
        {options.map((option, i) => (
          <span key={option.id} aria-hidden className={cn('absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full', !disabled && i < index ? 'bg-white' : 'bg-muted-foreground/45')} style={{left: stopLeft(i)}}/>
        ))}
        <span aria-hidden className={cn('absolute top-1/2 z-10 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm ring-1 ring-foreground/15', motion)} style={{left: stopLeft(index)}}/>
      </div>
    </div>
    <div aria-hidden className="px-3"><div className="flex justify-between gap-1" style={{paddingInline: STOP_INSET}}>{options.map(option => <span key={option.id} className={cn('min-h-8 text-xs leading-8', !disabled && value === option.id ? 'font-semibold text-signal' : 'text-muted-foreground')}>{option.id}</span>)}</div></div>
    <p id={descId} className="sr-only">档位 {scale}</p>
  </div>
}
