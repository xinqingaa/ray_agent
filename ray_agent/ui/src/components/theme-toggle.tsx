import {useTheme} from 'next-themes'
import {Monitor, Moon, Sun} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {useMounted} from '@/hooks/use-mounted'
import {THEME_OPTIONS} from '@/lib/theme'

/** 主题切换：跟随系统、浅色、深色，选择保存在浏览器本地 */
export function ThemeToggle({className, quick = false}: {className?: string; quick?: boolean}) {
  const {theme, resolvedTheme, setTheme} = useTheme()
  const mounted = useMounted()

  const Icon = !mounted ? Monitor : quick ? (resolvedTheme === 'dark' ? Sun : Moon) : (resolvedTheme === 'dark' ? Moon : Sun)
  const current = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? '跟随系统'

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={className ?? 'size-7'} aria-label="切换主题" disabled>
        <Icon/>
      </Button>
    )
  }

  if (quick) {
    const label = resolvedTheme === 'dark' ? '切换为浅色' : '切换为深色'
    return <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon" className={className} aria-label={label}
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}><Icon aria-hidden/></Button></TooltipTrigger>
      <TooltipContent side="right" sideOffset={7} tone="contrast" className="motion-reduce:animate-none">{label}</TooltipContent>
    </Tooltip>
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
          {THEME_OPTIONS.map((o) => (
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
