'use client'

import {useTheme} from 'next-themes'
import {Monitor, Moon, Sun} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {useMounted} from '@/hooks/use-mounted'

const OPTIONS = [
  {value: 'system', label: '跟随系统', icon: Monitor},
  {value: 'light', label: '浅色', icon: Sun},
  {value: 'dark', label: '深色', icon: Moon},
] as const

/** 主题切换：跟随系统、浅色、深色，选择保存在浏览器本地 */
export function ThemeToggle({className}: {className?: string}) {
  const {theme, resolvedTheme, setTheme} = useTheme()
  const mounted = useMounted()

  const Icon = !mounted ? Monitor : resolvedTheme === 'dark' ? Moon : Sun
  const current = OPTIONS.find((o) => o.value === theme)?.label ?? '跟随系统'

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={className ?? 'size-7'} aria-label="切换主题" disabled>
        <Icon/>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className ?? 'size-7'} aria-label={`切换主题，当前：${current}`}>
          <Icon/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">外观</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <o.icon className="size-4 text-muted-foreground"/>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
