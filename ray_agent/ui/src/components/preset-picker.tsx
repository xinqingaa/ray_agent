import {useEffect, useState} from 'react'
import {
  Briefcase, FileText, Globe, HeartHandshake, Presentation, Sparkles, Table, X, type UiIcon,
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

export function PresetIcon({name, className}: {name?: string; className?: string}) {
  const Icon = (name && PRESET_ICONS[name]) || Sparkles
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden/>
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
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
        inactive
          ? 'border-state-waiting/40 bg-state-waiting/10 text-state-waiting'
          : 'border-border/80 bg-muted/45 text-foreground',
        className,
      )}
      title={inactive ? (preset.inactive_reason ?? '该场景预设已停用，可点击退出回自由模式') : `当前场景：${preset.title}`}
    >
      <PresetIcon name={preset.icon} className={cn('size-3.5', inactive ? 'text-state-waiting' : 'text-signal')}/>
      <span className="truncate font-medium">{preset.title}</span>
      {inactive && <span className="shrink-0 text-[11px] opacity-90">（已停用）</span>}
      {onClear && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          aria-label={`退出场景 ${preset.title}`}
          title="退出场景，回到自由对话"
          className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <X className="size-3" aria-hidden/>
        </button>
      )}
    </div>
  )
}

export function PresetStarters({
  preset,
  disabled = false,
  onPick,
}: {
  preset: PresetItem
  disabled?: boolean
  onPick: (prompt: string) => void
}) {
  if (!preset.starters.length) return null
  return (
    <div aria-label={`${preset.title}起手选项`} className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
      {preset.starters.map(starter => (
        <button
          key={starter.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(starter.prompt)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {starter.label}
        </button>
      ))}
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                'group flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                selected
                  ? 'border-signal/50 bg-signal-soft/55 text-foreground'
                  : 'border-border/75 bg-card/60 text-foreground hover:border-foreground/20 hover:bg-muted/45',
              )}
            >
              <div className="flex w-full items-center gap-1.5">
                <PresetIcon name={item.icon} className={cn('size-3.5', selected ? 'text-signal' : 'text-muted-foreground group-hover:text-foreground')}/>
                <span className="truncate text-xs font-medium">{item.title}</span>
              </div>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{item.subtitle}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
