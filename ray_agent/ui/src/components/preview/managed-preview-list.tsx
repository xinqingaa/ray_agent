import {useState} from 'react'
import {toast} from 'sonner'
import {
  Eye, Finder, Globe, MoreHorizontal, PackageOpen, Play, RotateCw, Stop, Trash2,
} from '@/components/ui/icons'
import {IconAction} from '@/components/ui/icon-action'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {managedPreviewsApi, type ManagedPreview} from '@/lib/api/managed-previews'
import {fileManagerName, isDesktop, revealInFileManager} from '@/lib/platform'
import {cn} from '@/lib/utils'

const STATE_LABEL: Record<ManagedPreview['state'], string> = {
  ready: '可直接打开',
  running: '运行中',
  starting: '启动中…',
  stopped: '点击启动',
  failed: '启动失败',
}

export function ManagedPreviewList({
  previews,
  onOpen,
  onUpdated,
  onDeleted,
  onReveal,
}: {
  previews: ManagedPreview[]
  onOpen: (preview: ManagedPreview) => void
  onUpdated?: (preview: ManagedPreview) => void
  onDeleted?: (previewId: string) => void
  onReveal?: (preview: ManagedPreview) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  if (!previews.length) return null

  const runAction = async (preview: ManagedPreview, action: 'start' | 'stop' | 'restart' | 'delete' | 'zip') => {
    if (busyId === preview.id) return
    setBusyId(preview.id)
    try {
      if (action === 'zip') {
        const saved = await managedPreviewsApi.exportZip(preview)
        if (saved) toast.success(`已导出「${preview.name}.zip」`)
        return
      }
      if (action === 'delete') {
        await managedPreviewsApi.remove(preview.id)
        toast.success(`已移除预览「${preview.name}」`)
        onDeleted?.(preview.id)
        return
      }
      const next = action === 'start'
        ? await managedPreviewsApi.start(preview.id)
        : action === 'stop'
          ? await managedPreviewsApi.stop(preview.id)
          : await managedPreviewsApi.restart(preview.id)
      onUpdated?.(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyId(current => (current === preview.id ? null : current))
    }
  }

  return (
    <section aria-label="可运行预览" className="mb-3 space-y-1">
      <h2 className="px-1.5 py-1.5 text-xs font-medium text-faint">可运行预览</h2>
      <ul className="space-y-1">
        {previews.map(preview => {
          const busy = busyId === preview.id
          const running = preview.state === 'running'
          const reveal = preview.workspace_id && isDesktop()
            ? () => {
                if (onReveal) {
                  onReveal(preview)
                  return
                }
                void revealInFileManager(preview.root_id, preview.relative_path)
                  .catch(err => toast.error(err instanceof Error ? err.message : '无法显示位置'))
              }
            : undefined
          return (
            <li
              key={preview.id}
              className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2 py-1.5 hover:bg-muted/50"
            >
              <button
                type="button"
                onClick={() => onOpen(preview)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-signal-soft text-signal" aria-hidden>
                  <Globe className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" dir="auto">{preview.name}</span>
                  <span
                    className={cn(
                      'block truncate text-[11px]',
                      running || preview.state === 'ready' ? 'text-state-success'
                        : preview.state === 'failed' ? 'text-state-failed'
                          : 'text-muted-foreground',
                    )}
                  >
                    {STATE_LABEL[preview.state]}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconAction label={`打开预览 ${preview.name}`} onClick={() => onOpen(preview)}>
                  <Eye className="size-3.5" aria-hidden />
                </IconAction>
                {preview.kind === 'service' && (
                  running ? (
                    <IconAction label={`停止 ${preview.name}`} disabled={busy} onClick={() => void runAction(preview, 'stop')}>
                      <Stop className="size-3.5" aria-hidden />
                    </IconAction>
                  ) : (
                    <IconAction label={`启动 ${preview.name}`} disabled={busy} onClick={() => void runAction(preview, 'start')}>
                      <Play className="size-3.5" aria-hidden />
                    </IconAction>
                  )
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconAction label={`${preview.name} 的更多操作`}><MoreHorizontal className="size-3.5" aria-hidden /></IconAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onOpen(preview)}>
                      <Eye />打开预览
                    </DropdownMenuItem>
                    {preview.kind === 'service' && (
                      <DropdownMenuItem disabled={busy} onSelect={() => void runAction(preview, 'restart')}>
                        <RotateCw />重新启动
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem disabled={busy} onSelect={() => void runAction(preview, 'zip')}>
                      <PackageOpen />打包导出 ZIP
                    </DropdownMenuItem>
                    {reveal && (
                      <DropdownMenuItem onSelect={reveal}>
                        <Finder />在 {fileManagerName()} 中显示
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={busy} onSelect={() => void runAction(preview, 'delete')} className="text-state-failed">
                      <Trash2 />移除预览
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
