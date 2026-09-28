'use client'

import {createContext, useContext, useSyncExternalStore, type ReactNode} from 'react'

/**
 * 全页共用一个秒级时钟：只有需要走秒的组件订阅，没有订阅者时停止计时。
 * 视图模型只保存时间戳，已用时间在这里按当前时间计算。
 */
let tick = 0
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    tick = Date.now()
    timer = setInterval(() => {
      tick = Date.now()
      listeners.forEach((l) => l())
    }, 1000)
  }
  listener()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

const noopSubscribe = () => () => {}
const getTick = () => tick
const getServerTick = () => 0

/** 页面加载时刻；夹具时钟以它为零点 */
const PAGE_ORIGIN = typeof performance !== 'undefined' ? Math.round(performance.timeOrigin) : 0

const ClockOffsetContext = createContext(0)

/** 组件状态目录用：让“当前时间”从夹具记录的时刻开始走 */
export function FixtureClock({at, children}: {at: number; children: ReactNode}) {
  return <ClockOffsetContext.Provider value={at - PAGE_ORIGIN}>{children}</ClockOffsetContext.Provider>
}

/** active 为 false 时不订阅；未挂载（服务端渲染）时返回 null */
export function useNow(active: boolean): number | null {
  const offset = useContext(ClockOffsetContext)
  const value = useSyncExternalStore(active ? subscribe : noopSubscribe, getTick, getServerTick)
  if (!active || value === 0) return null
  return value + offset
}
