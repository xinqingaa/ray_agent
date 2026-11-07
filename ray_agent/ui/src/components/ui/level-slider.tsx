import {useId, useRef, useState} from 'react'
import {cn} from '@/lib/utils'

/** 轨道高度的一半：首末档圆心落在两端圆角的中心。 */
const INSET = 12

/** 有序离散档位的滑块：胶囊轨道、轨道内刻度和压在轨道上的圆形拖柄；整体是唯一 tab stop。档名由调用方显示。 */
export function LevelSlider({options, value, disabled = false, label, describe, onChange}: {
  options: readonly {id: string}[]
  value: string
  disabled?: boolean
  label: string
  /** 档位的读屏短名；原始 id 留在刻度提示里 */
  describe: (id: string) => string
  onChange: (id: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{origin: number; active: boolean} | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const descId = useId()
  const index = Math.max(0, options.findIndex(option => option.id === value))
  const max = Math.max(0, options.length - 1)
  const at = (i: number) => max === 0 ? '50%' : `calc(${INSET}px + (100% - ${INSET * 2}px) * ${i / max})`
  function move(next: number) {
    const id = options[Math.min(max, Math.max(0, next))]?.id
    if (id && id !== value) onChange(id)
  }
  function indexAt(clientX: number) {
    const rect = area.current?.getBoundingClientRect()
    if (!rect || max === 0) return 0
    const inner = rect.width - INSET * 2
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left - INSET) / inner)) * max)
  }
  const motion = dragging ? 'transition-none' : 'duration-150 ease-out motion-reduce:transition-none'
  return <div
    ref={area}
    role="slider"
    tabIndex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={disabled ? undefined : 0}
    aria-valuemax={disabled ? undefined : max}
    aria-valuenow={disabled ? undefined : index}
    aria-valuetext={disabled ? '思考已关闭' : describe(options[index]?.id ?? value)}
    aria-disabled={disabled || undefined}
    aria-describedby={descId}
    onKeyDown={event => {
      if (disabled) return
      const step = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[event.key]
      if (step) {event.preventDefault(); move(index + step)}
      else if (event.key === 'Home') {event.preventDefault(); move(0)}
      else if (event.key === 'End') {event.preventDefault(); move(max)}
    }}
    onPointerDown={event => {
      if (disabled) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = {origin: event.clientX, active: false}
      move(indexAt(event.clientX))
    }}
    onPointerMove={event => {
      const current = drag.current
      if (!current) return
      if (!current.active && Math.abs(event.clientX - current.origin) > 3) {current.active = true; setDragging(true)}
      move(indexAt(event.clientX))
    }}
    onPointerUp={() => {drag.current = null; setDragging(false)}}
    onPointerCancel={() => {drag.current = null; setDragging(false)}}
    className={cn('group/slider relative h-8 touch-none select-none rounded-full outline-none',
      disabled ? 'cursor-default' : 'cursor-pointer')}
  >
    <div aria-hidden className={cn('absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 rounded-full bg-muted-foreground/12 inset-ring inset-ring-border/60', disabled && 'opacity-60')}>
      <span className={cn('absolute inset-y-0 left-0 rounded-full bg-signal transition-[width]', disabled && 'invisible', motion)}
        style={{width: `calc(${INSET * 2}px + (100% - ${INSET * 2}px) * ${max === 0 ? 0 : index / max})`}}/>
      {options.map((option, i) => <span key={option.id} title={option.id}
        className={cn('absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
          !disabled && i <= index ? 'bg-white/55' : 'bg-muted-foreground/40')}
        style={{left: at(i)}}/>)}
    </div>
    <span aria-hidden className={cn('absolute top-1/2 z-10 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.12)]',
      'transition-[left,transform] group-active/slider:scale-95 group-focus-visible/slider:ring-2 group-focus-visible/slider:ring-ring group-focus-visible/slider:ring-offset-2 group-focus-visible/slider:ring-offset-popover',
      disabled && 'bg-card shadow-none ring-1 ring-border', motion)}
      style={{left: at(index)}}/>
    <p id={descId} className="sr-only">{disabled ? '思考已关闭' : `档位 ${options.map(option => describe(option.id)).join('、')}`}</p>
  </div>
}
