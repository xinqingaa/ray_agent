import {useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import {useTheme} from 'next-themes'
import {Button} from '@/components/ui/button'
import {Check, Pencil, X} from '@/components/ui/icons'
import {Input} from '@/components/ui/input'
import {cn} from '@/lib/utils'
import {Select} from '@/components/ui/select'
import {useWorkbenchWidth, writeWorkbenchWidth} from '@/components/workbench/resize-handle'
import {useMounted} from '@/hooks/use-mounted'
import {FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, applyFontSize, readFontSize} from '@/lib/font-size'
import {THEME_OPTIONS} from '@/lib/theme'
import {WORKBENCH_DEFAULT_PX, workbenchPresets} from '@/lib/workbench-width'
import {SectionHeader} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

const FONT_PRESETS = [FONT_SIZE_DEFAULT, 16, 18, FONT_SIZE_MAX].map(px => ({px, label: `${px} px`}))
const CUSTOM = 'custom'

function NumericPreference({id, label, description, value, presets, defaultValue, min, max, onChange}: {
  id: string
  label: string
  description: ReactNode
  value: number
  presets: {px: number; label: string}[]
  defaultValue: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const customLabel = `自定义${label}`
  const range = `${min}–${max} px`

  const editing = draft != null
  useLayoutEffect(() => {
    if (editing || !restoreFocus.current) return
    restoreFocus.current = false
    trigger.current?.focus({preventScroll: true})
  }, [editing])

  const closeEditor = (focusTrigger: boolean) => {
    restoreFocus.current = focusTrigger
    setDraft(null)
    setInvalid(false)
  }

  const choose = (option: string) => {
    setInvalid(false)
    if (option === CUSTOM) {
      setDraft(String(value))
    } else {
      setDraft(null)
      onChange(Number(option))
    }
  }

  const save = () => {
    const text = draft?.trim() ?? ''
    const number = Number(text)
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) {
      setInvalid(true)
      input.current?.focus({preventScroll: true})
      return
    }
    onChange(number)
    closeEditor(true)
  }

  return <div id={id}>
    <SettingsRow title={label} description={description} control={<>
      <div className="relative w-36">
        <Select label={label} className={cn('mt-0 px-2.5 tabular-nums', editing && 'invisible')} triggerRef={trigger}
          value={presets.some(preset => preset.px === value) ? String(value) : CUSTOM}
          displayValue={`${value} px`}
          options={[...presets.map(preset => ({id: String(preset.px), label: preset.label})), {id: CUSTOM, label: customLabel, icon: Pencil}]}
          onChange={choose}
          onCloseAutoFocus={event => {
            if (!input.current) return
            event.preventDefault()
            input.current.focus({preventScroll: true})
            input.current.select()
          }}/>
        {editing && <form className="absolute inset-0 flex items-center gap-1"
          onSubmit={event => {event.preventDefault(); save()}}
          onKeyDown={event => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            closeEditor(true)
          }}>
          <label htmlFor={`${id}-input`} className="sr-only">{customLabel}</label>
          <Input ref={input} id={`${id}-input`} type="text" inputMode="numeric" value={draft}
            aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
            className="h-full w-full bg-background px-2.5 pr-[4.25rem] tabular-nums shadow-none"
            onChange={event => {setInvalid(false); setDraft(event.target.value)}}/>
          <span aria-hidden className="pointer-events-none absolute right-[3.25rem] text-xs text-muted-foreground">px</span>
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`取消${customLabel}`} title="取消"
            onClick={() => closeEditor(true)} className="absolute right-6 text-muted-foreground"><X className="size-3.5" aria-hidden/></Button>
          <Button type="submit" size="icon-xs" variant="ghost" aria-label={`应用${customLabel}`} title={`应用${customLabel}`}
            className="absolute right-0.5 text-signal"><Check className="size-4" aria-hidden/></Button>
          <span id={`${id}-hint`} role={invalid ? 'alert' : undefined}
            className={invalid ? 'absolute top-full right-0 z-10 mt-1.5 w-max max-w-[calc(100vw-2rem)] rounded-md border bg-popover px-2 py-1.5 text-xs text-state-failed shadow-(--float-shadow)' : 'sr-only'}>
            {invalid ? `请输入 ${range} 之间的整数` : `可用范围 ${range}`}
          </span>
        </form>}
      </div>
      <Button type="button" size="sm" variant="ghost" aria-label={`恢复默认${label}`} onClick={() => {
        onChange(Math.min(max, Math.max(min, defaultValue)))
        closeEditor(false)
      }}>恢复默认</Button>
    </>}/>
  </div>
}

function FontSizeControl() {
  const [size, setSize] = useState(readFontSize)
  return <NumericPreference id="appearance-size" label="阅读字号" description="调整对话与文档的阅读字号。"
    value={size} min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} defaultValue={FONT_SIZE_DEFAULT} presets={FONT_PRESETS}
    onChange={value => {applyFontSize(value); setSize(value)}}/>
}

function WorkbenchWidthControl() {
  const {width, min, max, viewport} = useWorkbenchWidth()
  const presets = workbenchPresets(viewport).map(({label, px}) => ({px, label: `${label} · ${px} px`}))
  return <NumericPreference id="appearance-workbench-width" label="工作台宽度" description="也可拖动工作台分隔条调整。"
    value={width} min={min} max={max} defaultValue={WORKBENCH_DEFAULT_PX} presets={presets} onChange={writeWorkbenchWidth}/>
}

export function AppearanceSection() {
  const {theme, setTheme} = useTheme()
  const mounted = useMounted()

  return <section aria-labelledby="settings-appearance-title">
    <SectionHeader id="settings-appearance-title" title="外观"/>
    <div className="divide-y divide-border/70">
      <SettingsRow id="appearance-theme" title="主题"
        control={<SettingsSegment label="主题" value={mounted ? theme ?? 'system' : null}
          options={THEME_OPTIONS} disabled={!mounted} onChange={setTheme}/>}/>
      <FontSizeControl/>
      <WorkbenchWidthControl/>
    </div>
  </section>
}
