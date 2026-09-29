'use client'

import {useTheme} from 'next-themes'
import {Monitor, Moon, Sun} from 'lucide-react'
import {useMounted} from '@/hooks/use-mounted'
import {cn} from '@/lib/utils'
import {SectionHeader} from './form'

const THEMES = [
  {value: 'system', label: '跟随系统', icon: Monitor},
  {value: 'light', label: '浅色', icon: Sun},
  {value: 'dark', label: '深色', icon: Moon},
] as const

export function AppearanceSection() {
  const {theme, setTheme} = useTheme()
  const mounted = useMounted()

  return (
    <section aria-labelledby="settings-appearance-title">
      <SectionHeader id="settings-appearance-title" title="外观" description="选择界面主题。设置保存在当前浏览器中，切换后立即生效。"/>
      <div role="group" aria-label="界面主题" className="grid gap-2 sm:grid-cols-3">
        {THEMES.map(({value, label, icon: Icon}) => (
          <button key={value} type="button" disabled={!mounted} aria-pressed={mounted && theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-md border px-3 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
              mounted && theme === value && 'border-foreground/45 bg-muted font-medium',
            )}>
            <Icon className="size-4 text-muted-foreground" aria-hidden/>
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}
