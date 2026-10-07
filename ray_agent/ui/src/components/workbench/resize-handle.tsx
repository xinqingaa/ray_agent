'use client'

import {useEffect, useRef, useState} from 'react'
import {
  WORKBENCH_DEFAULT_PX,
  WORKBENCH_WIDTH_KEY,
  clampWorkbenchWidth,
  readWorkbenchWidth,
  workbenchBounds,
} from '@/lib/workbench-width'

export function useWorkbenchWidth() {
  const [width, setWidthState] = useState(WORKBENCH_DEFAULT_PX)
  const viewport = useRef(1280)
  const [bounds, setBounds] = useState(() => workbenchBounds(1280))
  useEffect(() => {
    const applyStored = () => {
      viewport.current = window.innerWidth
      setBounds(workbenchBounds(viewport.current))
      setWidthState(readWorkbenchWidth(window.localStorage.getItem(WORKBENCH_WIDTH_KEY), viewport.current))
    }
    applyStored()
    const onResize = () => {
      viewport.current = window.innerWidth
      setBounds(workbenchBounds(viewport.current))
      setWidthState(current => clampWorkbenchWidth(current, viewport.current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const setWidth = (px: number) => {
    const next = clampWorkbenchWidth(px, viewport.current)
    setWidthState(next)
    window.localStorage.setItem(WORKBENCH_WIDTH_KEY, String(Math.round(next)))
  }
  return {width, setWidth, reset: () => setWidth(WORKBENCH_DEFAULT_PX), min: bounds.min, max: bounds.max}
}

export function WorkbenchResizeHandle({width, min, max, onWidth, onReset, onDragging}: {
  width: number
  min: number
  max: number
  onWidth: (px: number) => void
  onReset: () => void
  onDragging: (dragging: boolean) => void
}) {
  const drag = useRef<{origin: number; start: number; active: boolean} | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整工作台宽度"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onDoubleClick={onReset}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {event.preventDefault(); onWidth(width + 16)}
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {event.preventDefault(); onWidth(width - 16)}
        else if (event.key === 'Home') {event.preventDefault(); onWidth(min)}
        else if (event.key === 'End') {event.preventDefault(); onWidth(max)}
      }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {origin: event.clientX, start: width, active: false}
        onDragging(true)
      }}
      onPointerMove={event => {
        const current = drag.current
        if (!current) return
        if (!current.active && Math.abs(event.clientX - current.origin) <= 3) return
        current.active = true
        onWidth(current.start + (current.origin - event.clientX))
      }}
      onPointerUp={() => {drag.current = null; onDragging(false)}}
      onPointerCancel={() => {drag.current = null; onDragging(false)}}
      className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}
