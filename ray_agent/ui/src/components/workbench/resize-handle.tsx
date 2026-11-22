import {useEffect, useRef, useState, useSyncExternalStore, type PointerEvent} from 'react'
import {
  WORKBENCH_DEFAULT_PX,
  WORKBENCH_WIDTH_KEY,
  clampWorkbenchWidth,
  readWorkbenchWidth,
  workbenchBounds,
} from '@/lib/workbench-width'

const WIDTH_CHANGED = 'rayagent:workbench-width-changed'
let memoryWidth: string | null = null

function subscribeWidth(update: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== WORKBENCH_WIDTH_KEY) return
    memoryWidth = null
    update()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('resize', update)
  window.addEventListener(WIDTH_CHANGED, update)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('resize', update)
    window.removeEventListener(WIDTH_CHANGED, update)
  }
}

function widthSnapshot() {
  let stored = memoryWidth
  if (stored === null) {
    try {stored = window.localStorage.getItem(WORKBENCH_WIDTH_KEY)} catch {stored = null}
  }
  return readWorkbenchWidth(stored, window.innerWidth)
}

export function writeWorkbenchWidth(px: number) {
  const stored = String(Math.round(clampWorkbenchWidth(px, window.innerWidth)))
  try {
    window.localStorage.setItem(WORKBENCH_WIDTH_KEY, stored)
    memoryWidth = null
  } catch {memoryWidth = stored}
  window.dispatchEvent(new Event(WIDTH_CHANGED))
}

export function useWorkbenchWidthPreference() {
  return useSyncExternalStore(subscribeWidth, widthSnapshot, () => WORKBENCH_DEFAULT_PX)
}

export function useWorkbenchWidth() {
  const preference = useWorkbenchWidthPreference()
  const viewport = useSyncExternalStore(subscribeWidth, () => window.innerWidth, () => 0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const setWidth = (px: number, save = true) => {
    if (save) {
      writeWorkbenchWidth(px)
      setDragWidth(null)
    } else {
      setDragWidth(px)
    }
  }
  return {
    width: dragWidth === null ? preference : clampWorkbenchWidth(dragWidth, viewport),
    viewport,
    ...workbenchBounds(viewport),
    setWidth,
    reset: () => setWidth(WORKBENCH_DEFAULT_PX),
  }
}

export function WorkbenchResizeHandle({width, min, max, onWidth, onReset, onResizingChange, label = '调整工作台宽度'}: {
  label?: string
  width: number
  min: number
  max: number
  onWidth: (px: number, save?: boolean) => void
  onReset: () => void
  /** 拖动开始与结束时通知面板容器，拖动期间关闭宽度过渡 */
  onResizingChange?: (resizing: boolean) => void
}) {
  const drag = useRef<{pointerId: number; origin: number; start: number; target?: number} | null>(null)
  const [resizing, setResizing] = useState(false)
  const setDragging = (value: boolean) => {
    setResizing(value)
    onResizingChange?.(value)
  }
  useEffect(() => () => onResizingChange?.(false), [onResizingChange])

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
    setDragging(false)
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
        setDragging(true)
      }}
      onPointerMove={resize}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      className="task-inspector-resize absolute inset-y-0 z-10 cursor-col-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}
