'use client'

import {useEffect, useState} from 'react'
import {useTheme} from 'next-themes'
import {Monitor, Moon, Sun} from 'lucide-react'
import {useMounted} from '@/hooks/use-mounted'
import {Select} from '@/components/ui/select'
import {
  FONT_SIZE_DEFAULT,
  acceptedFontSize,
  applyFontSize,
  fontSizeOptions,
  readFontSize,
} from '@/lib/font-size'
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
  const [size, setSize] = useState(FONT_SIZE_DEFAULT)

  useEffect(() => {
    setSize(readFontSize())
  }, [])

  const commit = (next: number) => {
    applyFontSize(next)
    setSize(next)
  }

  return (
    <section aria-labelledby="settings-appearance-title">
      <SectionHeader id="settings-appearance-title" title="外观" description="主题和文字大小保存在当前浏览器中，切换后立即生效。"/>
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

      <div className="mt-6 flex items-center justify-between gap-8 border-t py-4">
        <div className="min-w-0">
          <label htmlFor="settings-font-size" className="text-sm font-medium">字体</label>
          <p id="settings-font-hint" className="mt-0.5 text-xs leading-5 text-muted-foreground">调整字体大小</p>
        </div>
        <Select
          id="settings-font-size"
          describedBy="settings-font-hint"
          className="mt-0 w-40 shrink-0"
          label="字体"
          value={String(size)}
          options={fontSizeOptions(size)}
          disabled={!mounted}
          onChange={(id) => {
            const next = acceptedFontSize(Number(id))
            if (next != null) commit(next)
          }}
        />
      </div>
    </section>
  )
}
