import {useState, useSyncExternalStore} from 'react'
import {useTheme} from 'next-themes'
import {useMounted} from '@/hooks/use-mounted'
import {
  FONT_SIZE_DEFAULT,
  acceptedFontSize,
  applyFontSize,
  fontSizeOptions,
  readFontSize,
} from '@/lib/font-size'
import {SectionHeader} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

const THEMES = [
  {value: 'system', label: '跟随系统'},
  {value: 'light', label: '浅色'},
  {value: 'dark', label: '深色'},
] as const
type ThemeValue = (typeof THEMES)[number]['value']

/** 预设字号使用原型的中文档位名；存储中的非预设值以数字追加在末尾。 */
const SIZE_LABEL: Record<string, string> = {'14': '标准', '16': '较大', '18': '更大', '20': '最大'}

const subscribeFontSize = () => () => {}

export function AppearanceSection() {
  const {theme, setTheme} = useTheme()
  const mounted = useMounted()
  const storedSize = useSyncExternalStore(subscribeFontSize, readFontSize, () => FONT_SIZE_DEFAULT)
  const [selectedSize, setSize] = useState<number | null>(null)
  const size = selectedSize ?? storedSize

  const commit = (next: number) => {
    applyFontSize(next)
    setSize(next)
  }
  const sizeOptions = fontSizeOptions(size).map(option => ({
    value: option.id,
    label: SIZE_LABEL[option.id] ?? option.label,
  }))

  return (
    <section aria-labelledby="settings-appearance-title">
      <SectionHeader id="settings-appearance-title" title="外观"/>
      <div className="divide-y divide-border/70">
        <SettingsRow
          id="appearance-theme"
          title="主题"
          control={<SettingsSegment
            label="主题"
            value={mounted ? (theme as ThemeValue | undefined) ?? 'system' : null}
            options={THEMES}
            disabled={!mounted}
            onChange={setTheme}
          />}
        />
        <SettingsRow
          id="appearance-size"
          title="阅读字号"
          description="只放大文字，间距和图标不变。"
          control={<SettingsSegment
            label="阅读字号"
            value={String(size)}
            options={sizeOptions}
            disabled={!mounted}
            onChange={(id) => {
              const next = acceptedFontSize(Number(id))
              if (next != null) commit(next)
            }}
          />}
        />
      </div>
    </section>
  )
}
