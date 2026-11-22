import {useSyncExternalStore} from 'react'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** 读取 globals.css 中的动效曲线 token，供 WAAPI 动画使用（它不经过样式表）。 */
export function motionEasing(name: 'ease' | 'spring'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`).trim()
}

/** 读取时长 token 的毫秒数；读不到时返回 0，调用方据此跳过动画。 */
export function motionDuration(name: 'fast' | 'mid' | 'slow'): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`))
  return Number.isFinite(value) ? value : 0
}

/** 系统是否要求减少动态效果。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_QUERY).matches
}

function subscribeReducedMotion(update: () => void) {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE_QUERY) : null
  query?.addEventListener('change', update)
  return () => query?.removeEventListener('change', update)
}

/** 组件里读取减少动态效果偏好；偏好切换时重新渲染。 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}

/**
 * 程序写入内容后的短暂强调：底色从弱强调色淡回透明，时长取慢档的两倍。
 * 减少动态效果或环境不支持 WAAPI 时不做任何动画，内容本身已经说明写入结果。
 */
export function flashHighlight(node: HTMLElement | null) {
  if (!node || typeof node.animate !== 'function' || prefersReducedMotion()) return
  const duration = motionDuration('slow') * 2
  if (duration <= 0) return
  node.animate(
    [{backgroundColor: 'var(--signal-soft)'}, {backgroundColor: 'transparent'}],
    {duration, easing: motionEasing('ease') || 'ease-out'},
  )
}
