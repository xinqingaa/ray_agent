import {Globe, Play} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import type {ManagedPreview} from '@/lib/api/managed-previews'
import {cn} from '@/lib/utils'

const STATE_LABEL: Record<ManagedPreview['state'], string> = {
  ready: '可直接打开',
  running: '运行中',
  starting: '启动中…',
  stopped: '点击启动',
  failed: '启动失败',
}

const STATE_TONE: Record<ManagedPreview['state'], string> = {
  ready: 'text-state-success',
  running: 'text-state-success',
  starting: 'text-state-waiting',
  stopped: 'text-muted-foreground',
  failed: 'text-state-failed',
}

export function PreviewCard({
  name,
  previewKind,
  note,
  live,
  onOpen,
  className,
}: {
  name: string
  previewKind: 'static' | 'service'
  note?: string
  live?: ManagedPreview | null
  onOpen?: () => void
  className?: string
}) {
  const effectiveKind = live?.kind ?? previewKind
  const state = live?.state ?? (effectiveKind === 'static' ? 'ready' : 'stopped')
  const actionLabel = effectiveKind === 'service' && state === 'stopped' ? '启动并预览' : '预览'

  return (
    <section
      aria-label={`项目预览：${live?.name ?? name}`}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[14px] border border-signal/25 bg-signal-soft/30 px-3.5 py-2.5',
        className,
      )}
    >
      <span
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-signal-soft text-signal"
        aria-hidden
      >
        <Globe className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="min-w-0 truncate text-sm font-medium" dir="auto">{live?.name ?? name}</h3>
          <span className={cn('text-xs', STATE_TONE[state])}>{STATE_LABEL[state]}</span>
        </div>
        {note && <p className="text-meta text-muted-foreground wrap-anywhere">{note}</p>}
        {state === 'failed' && live?.error && (
          <p className="text-xs text-state-failed wrap-anywhere">{live.error}</p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="default"
        disabled={!onOpen}
        onClick={onOpen}
      >
        <Play className="size-3.5" aria-hidden />
        {actionLabel}
      </Button>
    </section>
  )
}
