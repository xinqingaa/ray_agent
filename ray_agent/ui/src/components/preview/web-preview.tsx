import {useCallback, useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'
import {
  AlertCircle, ChevronRight, Code, Download, ExternalLink, Finder, Globe, Monitor, MoreHorizontal, PackageOpen, Play,
  RefreshCw, RotateCw, Smartphone, Stop, Terminal, Trash2, Wand,
} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {managedPreviewsApi, type ManagedPreview} from '@/lib/api/managed-previews'
import {
  canDownload, createStaticPreviewMount, deleteStaticPreviewMount, downloadPreviewSource, exportStaticMountZip,
  saveDownload, type ManagedPreviewSource, type PreviewSource, type StaticPreviewMount, type StaticPreviewSource,
} from '@/lib/api/preview'
import {fileManagerName, isDesktop, openExternal, revealInFileManager} from '@/lib/platform'
import {cn} from '@/lib/utils'
import {PreviewAction} from './action'
import {PreviewDialog, PreviewFrame} from './preview-frame'

const BRIDGE_MAX_BYTES = 50 * 1024 * 1024
const MOUNT_REFRESH_BUFFER_MS = 60_000
const LOG_POLL_MS = 1500
const SANDBOX_FLAGS =
  'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox'

type ViewportMode = 'desktop' | 'mobile'

const MANAGED_STATE_LABEL: Record<ManagedPreview['state'], string> = {
  ready: '可直接打开',
  running: '运行中',
  starting: '启动中…',
  stopped: '未运行',
  failed: '启动失败',
}

function sourceIdentity(source: StaticPreviewSource): string {
  if (source.kind === 'attachment') return `attachment:${source.id}:${source.filename}`
  if (source.kind === 'root') return `root:${source.rootId}:${source.path}`
  return `root_dir:${source.rootId}:${source.path}:${source.entryPath ?? ''}`
}

function sourceTitle(source: StaticPreviewSource): string {
  return source.kind === 'root_dir' ? source.title : source.filename
}

function sanitizeDownloadName(raw: unknown): string {
  if (typeof raw !== 'string') return 'download'
  const last = raw.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = Array.from(last)
    .filter(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'download'
  return cleaned.slice(0, 200)
}

function toByteView(payload: unknown): Uint8Array | null {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  return null
}

function browserBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type WebPreviewProps = {
  source: PreviewSource
  onBack?: () => void
  backLabel?: string
  onDownload?: () => void
  onClose?: () => void
  canExpand?: boolean
  onReveal?: () => void
  onViewSource?: () => void
  onOpenAsSite?: () => void
  onPreviewChange?: (preview: ManagedPreview) => void
  onPreviewDeleted?: (previewId: string) => void
  onAskAgentFix?: (prompt: string) => void
  onRevealManaged?: (preview: ManagedPreview) => void
}

export function WebPreview(props: WebPreviewProps) {
  if (props.source.kind === 'managed') {
    return (
      <ManagedWebPreview
        key={props.source.previewId}
        source={props.source}
        onBack={props.onBack}
        backLabel={props.backLabel}
        onClose={props.onClose}
        canExpand={props.canExpand}
        onPreviewChange={props.onPreviewChange}
        onPreviewDeleted={props.onPreviewDeleted}
        onAskAgentFix={props.onAskAgentFix}
        onRevealManaged={props.onRevealManaged}
      />
    )
  }
  return <StaticMountWebPreview {...props} source={props.source} />
}

function toStaticSource(preview: ManagedPreview): StaticPreviewSource {
  if (preview.entry_path) {
    return {
      kind: 'root_dir',
      rootId: preview.root_id,
      path: preview.relative_path,
      title: preview.name,
      entryPath: preview.entry_path,
    }
  }
  return {
    kind: 'root',
    rootId: preview.root_id,
    path: preview.relative_path,
    filename: preview.name,
  }
}

function StaticMountWebPreview({
  source,
  onBack,
  backLabel,
  onDownload,
  onClose,
  canExpand = true,
  onReveal,
  onViewSource,
  onOpenAsSite,
}: Omit<WebPreviewProps, 'source'> & {source: StaticPreviewSource}) {
  const identity = sourceIdentity(source)
  const title = sourceTitle(source)
  const [mount, setMount] = useState<StaticPreviewMount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [iframeEpoch, setIframeEpoch] = useState(0)
  const [viewport, setViewport] = useState<ViewportMode>('desktop')
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const activeMountRef = useRef<StaticPreviewMount | null>(null)
  const epochRef = useRef(0)

  const replaceMount = useCallback((next: StaticPreviewMount | null) => {
    const previous = activeMountRef.current
    activeMountRef.current = next
    setMount(next)
    if (previous && previous.mount_token !== next?.mount_token) {
      void deleteStaticPreviewMount(previous.mount_token)
    }
  }, [])

  useEffect(() => {
    const token = ++epochRef.current
    setLoading(true)
    setError(null)
    void createStaticPreviewMount(source)
      .then(result => {
        if (token !== epochRef.current) {
          void deleteStaticPreviewMount(result.mount_token)
          return
        }
        replaceMount(result)
        setIframeEpoch(value => value + 1)
      })
      .catch(err => {
        if (token !== epochRef.current) return
        replaceMount(null)
        setError(err instanceof Error ? err.message : '预览启动失败')
      })
      .finally(() => {
        if (token === epochRef.current) setLoading(false)
      })
    return () => {
      epochRef.current += 1
    }
  }, [identity, reload, replaceMount]) // eslint-disable-line react-hooks/exhaustive-deps -- source 内容与 identity 一一对应

  useEffect(() => () => {
    const current = activeMountRef.current
    activeMountRef.current = null
    if (current) void deleteStaticPreviewMount(current.mount_token)
  }, [])

  useEffect(() => {
    if (!mount) return
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return
      if (event.origin !== mount.origin) return
      const data = event.data as Record<string, unknown> | null
      if (!data || typeof data !== 'object') return
      if (data.mountToken !== mount.mount_token) return

      if (data.type === 'rayagent:preview-download-error') {
        toast.error(typeof data.message === 'string' && data.message ? data.message : '导出失败')
        return
      }
      if (data.type !== 'rayagent:preview-download') return

      const view = toByteView(data.bytes)
      if (!view || view.byteLength > BRIDGE_MAX_BYTES) {
        toast.error('导出文件无效或超过 50 MiB 限制')
        return
      }
      const filename = sanitizeDownloadName(data.filename)
      const mimeType = typeof data.mimeType === 'string' && data.mimeType ? data.mimeType : 'application/octet-stream'
      const copy = new Uint8Array(view.byteLength)
      copy.set(view)
      const blob = new Blob([copy], {type: mimeType})

      if (!isDesktop()) {
        browserBlobDownload(blob, filename)
        toast.success(`已导出「${filename}」`)
        return
      }
      void saveDownload(blob, filename)
        .then(saved => {
          if (saved) toast.success(`已保存「${filename}」`)
        })
        .catch(err => {
          toast.error(err instanceof Error ? err.message : '保存失败')
        })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [mount])

  const ensureActiveMount = async (): Promise<StaticPreviewMount> => {
    const current = activeMountRef.current
    if (current && current.expires_at - Date.now() > MOUNT_REFRESH_BUFFER_MS) return current
    const fresh = await createStaticPreviewMount(source)
    replaceMount(fresh)
    setIframeEpoch(value => value + 1)
    return fresh
  }

  const refresh = () => {
    setError(null)
    setReload(value => value + 1)
  }

  const openInSystemBrowser = () => {
    void ensureActiveMount()
      .then(active => openExternal(active.preview_url))
      .catch(err => toast.error(err instanceof Error ? err.message : '在浏览器中打开失败'))
  }

  const downloadOriginal = () => {
    if (onDownload) {
      onDownload()
      return
    }
    if (!canDownload(source)) return
    void downloadPreviewSource(source)
      .then(saved => {
        if (saved !== null) toast.success(`已下载「${source.filename}」`)
      })
      .catch(err => toast.error(err instanceof Error ? err.message : '下载失败'))
  }

  const handleExportZip = async () => {
    if (exporting || source.kind !== 'root_dir') return
    setExporting(true)
    try {
      const active = await ensureActiveMount()
      const saved = await exportStaticMountZip(active, source.title)
      if (saved) toast.success(`已导出「${source.title}.zip」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打包导出失败')
    } finally {
      setExporting(false)
    }
  }

  const toolbarActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <PreviewAction
        label="桌面视口"
        icon={Monitor}
        pressed={viewport === 'desktop'}
        onClick={() => setViewport('desktop')}
      />
      <PreviewAction
        label="手机视口"
        icon={Smartphone}
        pressed={viewport === 'mobile'}
        onClick={() => setViewport('mobile')}
      />
      <PreviewAction label="刷新预览" icon={RefreshCw} disabled={loading} onClick={refresh} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="更多预览操作" className="text-muted-foreground">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onViewSource && (
            <DropdownMenuItem onSelect={onViewSource}>
              <Code />查看源码
            </DropdownMenuItem>
          )}
          {onOpenAsSite && (
            <DropdownMenuItem onSelect={onOpenAsSite}>
              <Globe />以所在目录作为静态站点预览
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={loading} onSelect={openInSystemBrowser}>
            <ExternalLink />在系统浏览器中打开
          </DropdownMenuItem>
          {canDownload(source) && (
            <DropdownMenuItem onSelect={downloadOriginal}>
              <Download />下载原件
            </DropdownMenuItem>
          )}
          {source.kind === 'root_dir' && (
            <DropdownMenuItem disabled={loading || exporting} onSelect={() => void handleExportZip()}>
              <PackageOpen />{exporting ? '正在打包…' : '打包导出 ZIP'}
            </DropdownMenuItem>
          )}
          {onReveal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onReveal}>
                <Finder />在 {fileManagerName()} 中显示
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const renderViewport = (activeInHere: boolean) => {
    if (loading && !mount) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <p className="text-xs text-muted-foreground" role="status">正在准备预览…</p>
        </div>
      )
    }
    if (error && !mount) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p role="alert" className="text-xs text-state-failed">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={refresh}>重试</Button>
        </div>
      )
    }
    if (!mount) return null
    if (!activeInHere) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-xs text-muted-foreground">正在大窗口中预览</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>回到此处</Button>
        </div>
      )
    }
    return (
      <div className={cn('flex h-full w-full min-h-0 flex-1 justify-center overflow-auto bg-muted/40', viewport === 'mobile' && 'p-3')}>
        <iframe
          key={`${mount.mount_token}:${iframeEpoch}`}
          ref={iframeRef}
          title={title}
          src={mount.preview_url}
          sandbox={SANDBOX_FLAGS}
          referrerPolicy="no-referrer"
          className={cn(
            'h-full border-0 bg-white',
            viewport === 'mobile' ? 'w-[390px] max-w-full rounded-xl border border-border shadow-sm' : 'w-full',
          )}
        />
      </div>
    )
  }

  const badge = source.kind === 'root_dir' ? (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-signal-soft text-signal" aria-hidden>
      <Globe className="size-3.5" />
    </span>
  ) : undefined

  return (
    <>
      <PreviewFrame
        filename={title}
        badge={badge}
        actions={toolbarActions}
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        onExpand={canExpand ? () => setExpanded(true) : undefined}
      >
        {renderViewport(!expanded)}
      </PreviewFrame>
      <PreviewDialog title={title} open={expanded} onClose={() => setExpanded(false)}>
        <PreviewFrame filename={title} badge={badge} actions={toolbarActions} onClose={() => setExpanded(false)}>
          {renderViewport(expanded)}
        </PreviewFrame>
      </PreviewDialog>
    </>
  )
}

function ManagedWebPreview({
  source,
  onBack,
  backLabel,
  onClose,
  canExpand = true,
  onPreviewChange,
  onPreviewDeleted,
  onAskAgentFix,
  onRevealManaged,
}: {
  source: ManagedPreviewSource
  onBack?: () => void
  backLabel?: string
  onClose?: () => void
  canExpand?: boolean
  onPreviewChange?: (preview: ManagedPreview) => void
  onPreviewDeleted?: (previewId: string) => void
  onAskAgentFix?: (prompt: string) => void
  onRevealManaged?: (preview: ManagedPreview) => void
}) {
  const [preview, setPreview] = useState<ManagedPreview | null>(source.initial ?? null)
  const [loading, setLoading] = useState(!source.initial)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [iframeEpoch, setIframeEpoch] = useState(0)
  const [viewport, setViewport] = useState<ViewportMode>('desktop')
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<{text: string; offset: number; truncated: boolean; error: string | null}>({
    text: '', offset: 0, truncated: false, error: null,
  })
  const logOffsetRef = useRef(0)
  const changeRef = useRef(onPreviewChange)
  changeRef.current = onPreviewChange

  useEffect(() => {
    let cancelled = false
    setLoading(prev => prev && !preview)
    setLoadError(null)
    void managedPreviewsApi.get(source.previewId)
      .then(fresh => {
        if (cancelled) return
        setPreview(fresh)
        setActionError(fresh.error ?? null)
        changeRef.current?.(fresh)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '读取项目预览失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source.previewId, reloadSeq]) // eslint-disable-line react-hooks/exhaustive-deps -- 首次和手动刷新拉取

  const refreshLogs = useCallback(async (reset = false) => {
    if (!preview || preview.kind !== 'service') return
    const nextOffset = reset ? 0 : logOffsetRef.current
    try {
      const chunk = await managedPreviewsApi.logs(preview.id, nextOffset)
      if (reset) {
        logOffsetRef.current = chunk.next_offset
        setLogs({text: chunk.text, offset: chunk.next_offset, truncated: chunk.truncated, error: null})
      } else {
        logOffsetRef.current = chunk.next_offset
        setLogs(current => ({
          text: chunk.truncated && nextOffset > 0 ? chunk.text : `${current.text}${chunk.text}`,
          offset: chunk.next_offset,
          truncated: current.truncated || chunk.truncated,
          error: null,
        }))
      }
    } catch (err) {
      setLogs(current => ({...current, error: err instanceof Error ? err.message : '读取日志失败'}))
    }
  }, [preview])

  useEffect(() => {
    if (!showLogs || !preview || preview.kind !== 'service') return
    void refreshLogs(logOffsetRef.current === 0)
    if (preview.state !== 'running' && preview.state !== 'starting') return
    const timer = window.setInterval(() => {
      void refreshLogs(false)
    }, LOG_POLL_MS)
    return () => window.clearInterval(timer)
  }, [showLogs, preview?.id, preview?.kind, preview?.state, refreshLogs]) // eslint-disable-line react-hooks/exhaustive-deps

  const badge = (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-signal-soft text-signal" aria-hidden>
      <Globe className="size-3.5" />
    </span>
  )

  if (loading && !preview) {
    return (
      <PreviewFrame filename="项目预览" badge={badge} onBack={onBack} backLabel={backLabel} onClose={onClose}>
        <div className="flex h-full items-center justify-center p-4">
          <p className="text-xs text-muted-foreground" role="status">正在读取项目预览…</p>
        </div>
      </PreviewFrame>
    )
  }

  if (loadError && !preview) {
    return (
      <PreviewFrame filename="项目预览" badge={badge} onBack={onBack} backLabel={backLabel} onClose={onClose}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p role="alert" className="text-xs text-state-failed">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadSeq(v => v + 1)}>重试</Button>
        </div>
      </PreviewFrame>
    )
  }

  if (!preview) return null

  const reveal = preview.workspace_id && isDesktop()
    ? () => {
        if (onRevealManaged) {
          onRevealManaged(preview)
          return
        }
        void revealInFileManager(preview.root_id, preview.relative_path)
          .catch(err => toast.error(err instanceof Error ? err.message : '无法显示位置'))
      }
    : undefined

  if (preview.kind === 'static') {
    return (
      <StaticMountWebPreview
        source={toStaticSource(preview)}
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        canExpand={canExpand}
        onReveal={reveal}
      />
    )
  }

  const runAction = async (kind: 'start' | 'stop' | 'restart') => {
    if (busy) return
    setBusy(kind)
    setActionError(null)
    if (kind === 'start' || kind === 'restart') {
      logOffsetRef.current = 0
      setLogs({text: '', offset: 0, truncated: false, error: null})
      setPreview(current => (current ? {...current, state: 'starting', error: null} : current))
    }
    try {
      const updated = kind === 'start'
        ? await managedPreviewsApi.start(preview.id)
        : kind === 'stop'
          ? await managedPreviewsApi.stop(preview.id)
          : await managedPreviewsApi.restart(preview.id)
      setPreview(updated)
      changeRef.current?.(updated)
      if (kind !== 'stop') setIframeEpoch(v => v + 1)
      if (showLogs) void refreshLogs(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败'
      setActionError(message)
      try {
        const latest = await managedPreviewsApi.get(preview.id)
        setPreview(latest)
        changeRef.current?.(latest)
      } catch {
        setPreview(current => (current ? {...current, state: 'failed', error: message} : current))
      }
      if (showLogs) void refreshLogs(true)
    } finally {
      setBusy(null)
    }
  }

  const handleExportZip = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const saved = await managedPreviewsApi.exportZip(preview)
      if (saved) toast.success(`已导出「${preview.name}.zip」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打包导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleRemove = async () => {
    if (busy) return
    setBusy('delete')
    try {
      await managedPreviewsApi.remove(preview.id)
      toast.success(`已移除预览「${preview.name}」`)
      onPreviewDeleted?.(preview.id)
      onBack?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除预览失败')
    } finally {
      setBusy(null)
    }
  }

  const running = preview.state === 'running' && !!preview.preview_url
  const starting = busy === 'start' || busy === 'restart' || preview.state === 'starting'
  const effectiveError = actionError ?? preview.error

  const toolbarActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <span
        className={cn(
          'mr-1 rounded-full px-2 py-0.5 text-[11px]',
          running ? 'bg-state-success/15 text-state-success'
            : preview.state === 'failed' ? 'bg-state-failed-soft text-state-failed'
              : starting ? 'bg-state-waiting-soft text-state-waiting'
                : 'bg-muted text-muted-foreground',
        )}
      >
        {starting ? '启动中…' : MANAGED_STATE_LABEL[preview.state]}
      </span>
      <PreviewAction
        label="桌面视口"
        icon={Monitor}
        pressed={viewport === 'desktop'}
        onClick={() => setViewport('desktop')}
      />
      <PreviewAction
        label="手机视口"
        icon={Smartphone}
        pressed={viewport === 'mobile'}
        onClick={() => setViewport('mobile')}
      />
      {running ? (
        <PreviewAction
          label="停止预览"
          icon={Stop}
          disabled={busy !== null}
          onClick={() => void runAction('stop')}
        />
      ) : (
        <PreviewAction
          label="启动预览"
          icon={Play}
          disabled={busy !== null}
          onClick={() => void runAction('start')}
        />
      )}
      <PreviewAction
        label="刷新预览"
        icon={RefreshCw}
        disabled={busy !== null}
        onClick={() => {
          if (running) setIframeEpoch(v => v + 1)
          setReloadSeq(v => v + 1)
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="更多预览操作" className="text-muted-foreground">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={busy !== null} onSelect={() => void runAction('restart')}>
            <RotateCw />重新启动
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowLogs(v => !v)}>
            <Terminal />{showLogs ? '收起运行日志' : '查看运行日志'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowDetails(v => !v)}>
            <Code />{showDetails ? '收起启动命令与目录' : '展开启动命令与目录'}
          </DropdownMenuItem>
          {running && preview.preview_url && (
            <DropdownMenuItem onSelect={() => void openExternal(preview.preview_url!)}>
              <ExternalLink />在系统浏览器中打开
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={exporting} onSelect={() => void handleExportZip()}>
            <PackageOpen />{exporting ? '正在打包…' : '打包导出 ZIP'}
          </DropdownMenuItem>
          {reveal && (
            <DropdownMenuItem onSelect={reveal}>
              <Finder />在 {fileManagerName()} 中显示
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy !== null} onSelect={() => void handleRemove()} className="text-state-failed">
            <Trash2 />移除预览
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const technicalDrawer = (showDetails || showLogs) && (
    <div className="shrink-0 space-y-2 border-t bg-muted/30 px-3 py-2.5 text-xs">
      {showDetails && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 font-medium text-muted-foreground">
            <ChevronRight className="size-3.5 rotate-90" aria-hidden />启动配置
          </div>
          <p className="font-mono text-[11px] wrap-anywhere text-foreground">
            命令：{preview.start_command || '未设置'}
          </p>
          <p className="font-mono text-[11px] wrap-anywhere text-muted-foreground">
            目录：{preview.relative_path || '(根目录)'} · 健康路径：{preview.health_path}
            {preview.port ? ` · 端口：${preview.port}` : ''}
          </p>
        </div>
      )}
      {showLogs && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-muted-foreground">运行日志</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => void refreshLogs(true)}>刷新日志</Button>
          </div>
          {logs.error ? (
            <p role="alert" className="text-state-failed">{logs.error}</p>
          ) : (
            <pre
              aria-label="预览服务运行日志"
              className="max-h-40 overflow-auto rounded-lg border bg-background p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap wrap-anywhere"
            >
              {logs.text || '暂无输出日志'}
            </pre>
          )}
        </div>
      )}
    </div>
  )

  const renderViewport = (activeInHere: boolean) => {
    if (!activeInHere) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-xs text-muted-foreground">正在大窗口中预览</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>回到此处</Button>
        </div>
      )
    }

    if (starting) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-xs text-muted-foreground" role="status">正在启动「{preview.name}」…</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowLogs(true)}>查看日志</Button>
        </div>
      )
    }

    if (preview.state === 'failed' || (effectiveError && !running)) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertCircle className="size-7 text-state-failed" aria-hidden />
          <div className="max-w-md space-y-1">
            <p className="text-sm font-medium">预览暂时无法启动</p>
            <p role="alert" className="text-xs text-state-failed wrap-anywhere">
              {effectiveError || '服务未能正常响应，请重试或查看运行日志'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void runAction('start')}>
              重试启动
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowLogs(true)}>
              查看运行日志
            </Button>
            {onAskAgentFix && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onAskAgentFix(
                    `预览「${preview.name}」启动失败：${effectiveError || '无法通过健康检查'}。请检查并修复后重新登记预览。`,
                  )
                }
              >
                <Wand className="size-3.5" aria-hidden />让 Agent 修复
              </Button>
            )}
          </div>
        </div>
      )
    }

    if (!running) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-signal-soft text-signal" aria-hidden>
            <Globe className="size-5" />
          </span>
          <div className="max-w-sm space-y-1">
            <p className="text-sm font-medium">{preview.name}</p>
            <p className="text-xs text-muted-foreground">点击下方按钮在本机启动应用内预览，关闭应用后会自动清理。</p>
          </div>
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void runAction('start')}>
            <Play className="size-3.5" aria-hidden />启动预览
          </Button>
        </div>
      )
    }

    return (
      <div className={cn('flex h-full w-full min-h-0 flex-1 justify-center overflow-auto bg-muted/40', viewport === 'mobile' && 'p-3')}>
        <iframe
          key={`${preview.id}:${preview.port}:${iframeEpoch}`}
          title={preview.name}
          src={preview.preview_url!}
          sandbox={SANDBOX_FLAGS}
          referrerPolicy="no-referrer"
          className={cn(
            'h-full border-0 bg-white',
            viewport === 'mobile' ? 'w-[390px] max-w-full rounded-xl border border-border shadow-sm' : 'w-full',
          )}
        />
      </div>
    )
  }

  return (
    <>
      <PreviewFrame
        filename={preview.name}
        badge={badge}
        actions={toolbarActions}
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        onExpand={canExpand ? () => setExpanded(true) : undefined}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {renderViewport(!expanded)}
          {technicalDrawer}
        </div>
      </PreviewFrame>
      <PreviewDialog title={preview.name} open={expanded} onClose={() => setExpanded(false)}>
        <PreviewFrame filename={preview.name} badge={badge} actions={toolbarActions} onClose={() => setExpanded(false)}>
          <div className="flex h-full min-h-0 flex-1 flex-col">
            {renderViewport(expanded)}
            {technicalDrawer}
          </div>
        </PreviewFrame>
      </PreviewDialog>
    </>
  )
}
