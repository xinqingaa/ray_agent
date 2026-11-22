import {useLayoutEffect, useRef} from 'react'
import {useTheme} from 'next-themes'
import {Monitor, Moon, Sun} from '@/components/ui/icons'

export const THEME_OPTIONS = [
  {value: 'system', label: '跟随系统', icon: Monitor},
  {value: 'light', label: '浅色', icon: Sun},
  {value: 'dark', label: '深色', icon: Moon},
] as const

const palette = [
  '--canvas', '--rail', '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--primary', '--primary-foreground', '--secondary',
  '--secondary-foreground', '--muted', '--muted-foreground', '--faint', '--accent', '--accent-foreground',
  '--destructive', '--border', '--input', '--ring', '--scrim', '--signal', '--signal-soft', '--signal-foreground',
  '--state-running', '--state-running-soft', '--state-waiting', '--state-waiting-soft',
  '--state-success', '--state-success-soft', '--state-failed', '--state-failed-soft',
  '--state-stopped', '--state-stopped-soft', '--state-interrupted', '--state-interrupted-soft',
  '--terminal', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground',
  '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring',
]

let motion: 'palette' | 'surfaces' | undefined

function prepareThemeMotion(html: HTMLElement) {
  if (motion) return motion
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') return motion = 'surfaces'
  for (const name of palette) {
    try {
      CSS.registerProperty({name, syntax: '<color>', inherits: true, initialValue: 'transparent'})
    } catch (error) {
      // 热更新可能在同一文档中再次注册这组颜色。
      if (!(error instanceof DOMException) || error.name !== 'InvalidModificationError') return motion = 'surfaces'
    }
  }
  html.style.setProperty('--theme-transition-properties', palette.join(', '))
  return motion = 'palette'
}

/** 偏好与系统配色由 next-themes 解析，实际配色由根元素统一发布。 */
export function useThemeSurface() {
  const {resolvedTheme} = useTheme()
  const applied = useRef<'light' | 'dark' | null>(null)

  useLayoutEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return
    if (applied.current === resolvedTheme) return

    const html = document.documentElement
    const mode = prepareThemeMotion(html)
    // 首次着色和后台更新立即应用，前台切换由 CSS 从当前绘制颜色过渡。
    if (applied.current && !document.hidden) html.dataset.themeMotion = mode
    else delete html.dataset.themeMotion

    html.classList.toggle('dark', resolvedTheme === 'dark')
    html.classList.toggle('light', resolvedTheme === 'light')
    html.style.colorScheme = resolvedTheme
    applied.current = resolvedTheme
  }, [resolvedTheme])
}
