import {useState, useSyncExternalStore} from 'react'
import {useTheme} from 'next-themes'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {LevelSlider} from '@/components/ui/level-slider'
import {useWorkbenchWidth, writeWorkbenchWidth} from '@/components/workbench/resize-handle'
import {useMounted} from '@/hooks/use-mounted'
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEPS,
  acceptedFontSize,
  applyFontSize,
  readFontSize,
} from '@/lib/font-size'
import {clampWorkbenchWidth, WORKBENCH_DEFAULT_PX, workbenchPresets} from '@/lib/workbench-width'
import {SectionHeader} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

const THEMES = [
  {value: 'system', label: '跟随系统'},
  {value: 'light', label: '浅色'},
  {value: 'dark', label: '深色'},
] as const
type ThemeValue = (typeof THEMES)[number]['value']

const subscribeFontSize = () => () => {}

const PREVIEW_TEXT = '把周会纪要按决定、待办和风险分组，发送前可以再改。'

/** 阅读字号：带刻度的滑杆覆盖允许范围内的每个整数，旁边显示当前值与一行即时预览。 */
function FontSizeControl() {
  const mounted = useMounted()
  const storedSize = useSyncExternalStore(subscribeFontSize, readFontSize, () => FONT_SIZE_DEFAULT)
  const [selectedSize, setSize] = useState<number | null>(null)
  const size = selectedSize ?? storedSize

  const commit = (next: number) => {
    applyFontSize(next)
    setSize(next)
  }

  return (
    <div className="py-3.5" id="appearance-size">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div id="appearance-size-title" className="text-sm font-medium">阅读字号</div>
          <div className="mt-0.5 text-meta leading-5 text-muted-foreground">只放大文字，间距和图标不变。</div>
        </div>
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <div className="w-56 max-w-full">
            <LevelSlider label="阅读字号" options={FONT_SIZE_STEPS} value={String(size)} disabled={!mounted}
              describe={id => `${id}px`}
              onChange={id => {
                const next = acceptedFontSize(Number(id))
                if (next != null) commit(next)
              }}/>
          </div>
          <span aria-hidden className="w-11 text-right text-sm font-medium tabular-nums">{size}px</span>
          <Button type="button" size="sm" variant="ghost" disabled={!mounted}
            onClick={() => commit(FONT_SIZE_DEFAULT)}>恢复默认（{FONT_SIZE_DEFAULT}px）</Button>
        </div>
      </div>
      <p aria-hidden className="mt-3 truncate rounded-lg bg-muted px-3.5 py-2.5 leading-relaxed text-foreground"
        style={{fontSize: `${size}px`}}>{PREVIEW_TEXT}</p>
    </div>
  )
}

/** 示意图：窗口宽度中工作台所占的比例，宽度变化时平滑过渡。 */
function WidthSchematic({ratio}: {ratio: number}) {
  return (
    <div aria-hidden className="flex h-12 gap-1.5 overflow-hidden rounded-lg border bg-background p-1.5">
      <div className="flex min-w-0 flex-1 items-center rounded-md bg-muted px-2.5 text-meta whitespace-nowrap text-muted-foreground">对话区</div>
      <div className="flex min-w-10 items-center justify-center overflow-hidden rounded-md bg-signal-soft text-meta whitespace-nowrap text-signal transition-[width] duration-(--motion-slow) ease-(--motion-spring) motion-reduce:transition-none"
        style={{width: `${ratio}%`}}>工作台</div>
    </div>
  )
}

/**
 * 工作台宽度与拖动分隔条共用同一份偏好：这里写入后分隔条即时同步，反之亦然。
 * 自定义输入越界时就地提示并夹到范围，不静默改值。
 */
function WorkbenchWidthControl() {
  const {width, min, max, viewport} = useWorkbenchWidth()
  const presets = workbenchPresets(viewport)
  // 提示与产生它的宽度绑定：宽度被别处改动后提示即失效，不残留旧说明。
  const [notice, setNotice] = useState<{base: number; text: string} | null>(null)
  const [edit, setEdit] = useState<{base: number; text: string} | null>(null)
  const hint = notice && notice.base === width ? notice.text : ''
  const draft = edit && edit.base === width ? edit.text : String(width)
  const ratio = Math.min(100, Math.max(0, (width / Math.max(1, viewport)) * 100))

  const commitDraft = () => {
    if (edit == null) return
    setEdit(null)
    const text = edit.text.trim()
    const value = Number(text)
    if (text === '' || !Number.isInteger(value)) {
      setNotice({base: width, text: `请输入 ${min} 至 ${max} 之间的整数像素。`})
      return
    }
    const clamped = clampWorkbenchWidth(value, viewport)
    writeWorkbenchWidth(clamped)
    if (clamped === value) setNotice(null)
    else setNotice({base: clamped, text: value < min
      ? `${value} px 低于下限，已调整为 ${clamped} px。`
      : `${value} px 高于上限，已调整为 ${clamped} px。`})
  }

  return (
    <div className="py-3.5" id="appearance-workbench-width">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div id="appearance-workbench-width-title" className="text-sm font-medium">工作台宽度</div>
          <div className="mt-0.5 text-meta leading-5 text-muted-foreground">
            当前 <span className="tabular-nums">{width} px</span>，也可拖动工作台分隔条调整。
          </div>
        </div>
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          <SettingsSegment<string> label="工作台宽度预设" value={presets.some(item => item.px === width) ? String(width) : null}
            options={presets.map(item => ({value: String(item.px), label: `${item.label} ${item.px}`}))}
            onChange={value => {
              setNotice(null)
              writeWorkbenchWidth(Number(value))
            }}/>
          <Button type="button" size="sm" variant="ghost" onClick={() => {
            setNotice(null)
            writeWorkbenchWidth(WORKBENCH_DEFAULT_PX)
          }}>恢复默认（{WORKBENCH_DEFAULT_PX}）</Button>
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        <WidthSchematic ratio={ratio}/>
        <p className="text-meta text-muted-foreground">示意：工作台占当前窗口宽度的比例。</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="appearance-workbench-width-input" className="text-meta text-muted-foreground">自定义宽度</label>
          <Input id="appearance-workbench-width-input" type="number" inputMode="numeric" min={min} max={max} step={1}
            value={draft} aria-describedby="appearance-workbench-width-hint"
            className="h-8 w-24 tabular-nums"
            onChange={event => setEdit({base: width, text: event.target.value})}
            onBlur={commitDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft()
              }
            }}/>
          <span className="text-meta text-muted-foreground">px，可用范围 {min} 至 {max}</span>
        </div>
        <p id="appearance-workbench-width-hint" role="status" className="min-h-5 text-meta text-state-waiting">{hint}</p>
      </div>
    </div>
  )
}

export function AppearanceSection() {
  const {theme, setTheme} = useTheme()
  const mounted = useMounted()

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
        <FontSizeControl/>
        <WorkbenchWidthControl/>
      </div>
    </section>
  )
}
