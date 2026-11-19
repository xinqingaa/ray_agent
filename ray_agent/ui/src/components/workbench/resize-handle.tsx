import {useEffect, useRef, useState, type PointerEvent, type RefObject} from 'react'
import {
  WORKBENCH_DEFAULT_PX,
  WORKBENCH_WIDTH_KEY,
  clampWorkbenchWidth,
  readWorkbenchWidth,
  workbenchBounds,
} from '@/lib/workbench-width'

export function useWorkbenchWidth(preference: RefObject<number | null>) {
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [preferredWidth, setPreferredWidth] = useState(() => {
    if (preference.current != null) return preference.current
    try {
      return readWorkbenchWidth(window.localStorage.getItem(WORKBENCH_WIDTH_KEY), window.innerWidth)
    } catch {
      return WORKBENCH_DEFAULT_PX
    }
  })
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const setWidth = (px: number, save = true) => {
    const next = clampWorkbenchWidth(px, window.innerWidth)
    preference.current = next
    setPreferredWidth(next)
    if (save) {
      try {window.localStorage.setItem(WORKBENCH_WIDTH_KEY, String(Math.round(next)))} catch {/* Keep the in-memory width. */}
    }
  }
  return {
    width: clampWorkbenchWidth(preferredWidth, viewport),
    ...workbenchBounds(viewport),
    setWidth,
    reset: () => setWidth(WORKBENCH_DEFAULT_PX),
  }
}

export function WorkbenchResizeHandle({width, min, max, onWidth, onReset, label = '调整工作台宽度'}: {
  label?: string
  width: number
  min: number
  max: number
  onWidth: (px: number, save?: boolean) => void
  onReset: () => void
}) {
  const drag = useRef<{pointerId: number; origin: number; start: number; target?: number} | null>(null)
  const [resizing, setResizing] = useState(false)

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    const delta = current.origin - event.clientX
    if (current.target == null && Math.abs(delta) <= 3) return
    current.target = current.start + delta
    onWidth(current.target, false)
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    if (event.type === 'pointerup') resize(event)
    drag.current = null
    setResizing(false)
    if (current.target != null) onWidth(current.target)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      data-resizing={resizing}
      onDoubleClick={onReset}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {event.preventDefault(); onWidth(width + 16)}
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {event.preventDefault(); onWidth(width - 16)}
        else if (event.key === 'Home') {event.preventDefault(); onWidth(min)}
        else if (event.key === 'End') {event.preventDefault(); onWidth(max)}
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({preventScroll: true})
        drag.current = {pointerId: event.pointerId, origin: event.clientX, start: width}
        setResizing(true)
      }}
      onPointerMove={resize}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      className="task-inspector-resize absolute inset-y-0 z-10 cursor-col-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}
