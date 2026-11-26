import {useEffect, useState} from 'react'
import {
  Briefcase, Check, FileText, Globe, HeartHandshake, Presentation, Sparkles, Table, X, type UiIcon,
} from '@/components/ui/icons'
import {SKILLS_CHANGED, skillsApi, type PresetItem, type SessionPresetState} from '@/lib/api/skills'
import {cn} from '@/lib/utils'

const PRESET_ICONS: Record<string, UiIcon> = {
  presentation: Presentation,
  table: Table,
  globe: Globe,
  'file-text': FileText,
  briefcase: Briefcase,
  'heart-handshake': HeartHandshake,
}

export function presetIconComponent(name?: string): UiIcon {
  return (name && PRESET_ICONS[name]) || Sparkles
}

export function PresetIcon({name, className}: {name?: string; className?: string}) {
  const Icon = presetIconComponent(name)
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden/>
}

/** 判断输入框正文是否仍等于任一场景起手模板（用户手写或改写后返回 false）。 */
export function isPresetStarterPrompt(text: string, presets: PresetItem[]): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return presets.some(preset => preset.starters.some(starter => starter.prompt.trim() === trimmed))
}

export function usePresets(workspaceId?: string) {
  const [presets, setPresets] = useState<PresetItem[]>([])
  useEffect(() => {
    let active = true
    const load = () => {
      void skillsApi.listPresets(workspaceId).then(items => {
        if (active) setPresets(items)
      }).catch(() => {})
    }
    load()
    window.addEventListener(SKILLS_CHANGED, load)
    return () => {
      active = false
      window.removeEventListener(SKILLS_CHANGED, load)
    }
  }, [workspaceId])
  return presets
}

export function PresetCapsule({
  preset,
  disabled = false,
  onClear,
  className,
}: {
  preset: Pick<SessionPresetState, 'id' | 'title' | 'icon'> & {active?: boolean; inactive_reason?: string | null}
  disabled?: boolean
  onClear?: () => void
  className?: string
}) {
  const inactive = preset.active === false
  return (
    <div
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs font-medium transition-colors duration-(--motion-fast)',
        inactive
          ? 'border-state-waiting/35 bg-state-waiting-soft/80 text-state-waiting'
          : 'border-signal/25 bg-signal-soft/75 text-signal',
        className,
      )}
      title={inactive ? (preset.inactive_reason ?? '该场景预设已停用，可点击退出回自由模式') : `当前场景：${preset.title}`}
    >
      <PresetIcon name={preset.icon} className="size-3.5"/>
      <span className="truncate">{preset.title}</span>
      {inactive && <span className="shrink-0 text-[11px] font-normal opacity-90">（已停用）</span>}
      {onClear && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          aria-label={`退出场景 ${preset.title}`}
          title="退出场景，回到自由对话（输入框输入 / 或 @ 可随时重新选择）"
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            inactive
              ? 'text-state-waiting/80 hover:bg-state-waiting/15 hover:text-state-waiting'
              : 'text-signal/75 hover:bg-signal/15 hover:text-signal',
          )}
        >
          <X className="size-3" aria-hidden/>
        </button>
      )}
    </div>
  )
}

export function PresetStarters({
  preset,
  activePrompt,
  disabled = false,
  onPick,
}: {
  preset: PresetItem
  activePrompt?: string
  disabled?: boolean
  onPick: (prompt: string) => void
}) {
  if (!preset.starters.length) return null
  const current = activePrompt?.trim() ?? ''
  return (
    <div aria-label={`${preset.title}起手选项`} className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
      {preset.starters.map(starter => {
        const active = Boolean(current && current === starter.prompt.trim())
        return (
          <button
            key={starter.label}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(starter.prompt)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors duration-(--motion-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              active
                ? 'border-signal/40 bg-signal-soft/75 font-medium text-signal'
                : 'border-border/80 bg-background/85 text-muted-foreground hover:border-signal/35 hover:bg-signal-soft/35 hover:text-foreground',
            )}
          >
            {active && <Check className="size-3 shrink-0" aria-hidden/>}
            <span>{starter.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function PresetPicker({
  presets,
  selectedId,
  disabled = false,
  onSelect,
}: {
  presets: PresetItem[]
  selectedId: string | null
  disabled?: boolean
  onSelect: (presetId: string | null) => void
}) {
  if (!presets.length) return null
  return (
    <section aria-label="常用场景" className="mt-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map(item => {
          const selected = item.id === selectedId
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : item.id)}
              className={cn(
                'group flex flex-col rounded-xl border px-3.5 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-(--motion-fast) motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                selected
                  ? 'border-signal/45 bg-signal-soft/40 ring-1 ring-signal/15'
                  : 'border-border/75 bg-card/75 hover:border-signal/35 hover:bg-card',
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PresetIcon
                    name={item.icon}
                    className={cn(
                      'size-3.5 transition-colors duration-(--motion-fast)',
                      selected ? 'text-signal' : 'text-muted-foreground group-hover:text-signal',
                    )}
                  />
                  <span className={cn('truncate text-xs font-medium leading-5', selected ? 'text-signal' : 'text-foreground')}>
                    {item.title}
                  </span>
                </span>
                {selected && <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden/>}
              </span>
              <span className="mt-1 block w-full truncate text-[11.5px] leading-4 text-muted-foreground" title={item.subtitle}>
                {item.subtitle}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
