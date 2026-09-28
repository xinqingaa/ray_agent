'use client'

import {useEffect, useState} from 'react'
import {Globe, Monitor, PanelRightClose, Play, Terminal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {fileApi} from '@/lib/api/file'
import {sessionApi} from '@/lib/api/session'
import type {FileView, ToolCallView, ToolFamily} from '@/lib/session-view'
import {cn} from '@/lib/utils'
import {toast} from 'sonner'
import {fileIcon, previewUnavailableReason} from '@/components/run/file-icon'
import {formatBytes} from '@/components/run/format'
import {TOOL_STATUS} from '@/components/run/status-meta'

export type WorkbenchTab = 'terminal' | 'browser' | 'files'

type WorkbenchProps = {
  sessionId: string
  /** 跟随或固定查看的调用；没有工具时为空 */
  focus: ToolCallView | null
  /** 为 true 时新的工具调用会替换 focus */
  following: boolean
  shellCall: ToolCallView | null
  browserCall: ToolCallView | null
  files: FileView[]
  tab: WorkbenchTab
  onTab: (tab: WorkbenchTab) => void
  /** 从交付卡打开时预览的文件 */
  highlightFileId?: string | null
  onFollowLatest: () => void
  onClose: () => void
  onOpenVnc?: () => void
  className?: string
}

const TABS: Array<{id: WorkbenchTab; label: string}> = [
  {id: 'terminal', label: '终端'},
  {id: 'browser', label: '浏览器'},
  {id: 'files', label: '文件'},
]

export function tabForFamily(family: ToolFamily): WorkbenchTab {
  if (family === 'browser') return 'browser'
  if (family === 'file' || family === 'deliver') return 'files'
  return 'terminal'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function shellSessionId(call: ToolCallView | null): string | null {
  if (!call) return null
  const args = call.raw.args ?? {}
  const id = args.session_id ?? args.shell_session_id
  return typeof id === 'string' && id ? id : null
}

type ConsoleRow = {ps1: string; command: string; output: string}

function consoleRows(call: ToolCallView | null): ConsoleRow[] {
  const content = asRecord(call?.raw.content)
  const rows = content?.console
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const rec = asRecord(row)
    if (!rec) return []
    return [{
      ps1: typeof rec.ps1 === 'string' ? rec.ps1 : '$',
      command: typeof rec.command === 'string' ? rec.command : '',
      output: typeof rec.output === 'string' ? rec.output : '',
    }]
  })
}

function screenshotSrc(call: ToolCallView | null): string | null {
  const content = asRecord(call?.raw.content)
  const raw = content?.screenshot ?? content?.image
  if (typeof raw !== 'string' || !raw) return null
  if (raw.startsWith('data:') || raw.startsWith('http')) return raw
  return `data:image/png;base64,${raw}`
}

function fileBody(call: ToolCallView | null): string | null {
  const content = call?.raw.content
  if (typeof content === 'string') return content
  const rec = asRecord(content)
  if (!rec) return null
  if (typeof rec.content === 'string') return rec.content
  return null
}

function resultExcerpt(call: ToolCallView): string | null {
  const body = fileBody(call)
  if (body) return body
  const rows = consoleRows(call)
  if (rows.length > 0) return rows.map((row) => row.output).filter(Boolean).join('\n')
  const content = call.raw.content
  if (content == null) return null
  if (typeof content === 'string') return content
  return JSON.stringify(content, null, 2)
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.csv', '.tsv', '.log', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.sh', '.yml', '.yaml', '.xml',
])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

function extOf(file: FileView): string {
  const ext = file.extension || ''
  return ext.startsWith('.') ? ext.toLowerCase() : ext ? `.${ext.toLowerCase()}` : ''
}

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadSessionFile(file: FileView) {
  const blob = await fileApi.downloadFile(file.id)
  await saveBlob(blob, file.filename)
}

function EmptyNote({children}: {children: string}) {
  return <p className="px-4 py-8 text-center text-meta text-faint">{children}</p>
}

function ShellPane({sessionId, call}: {sessionId: string; call: ToolCallView | null}) {
  const running = call?.status === 'running'
  const session = shellSessionId(call)
  const pullKey = `${call?.callId ?? ''}:${session ?? ''}`
  // 输出与错误都记下所属调用，切换调用后旧状态不再显示
  const [pulled, setPulled] = useState<{key: string; output: string | null; error: string | null} | null>(null)
  const current = pulled?.key === pullKey ? pulled : null
  const live = current?.output ?? null
  const liveError = current?.error ?? null

  useEffect(() => {
    if (!running || !session) return
    let cancelled = false
    const pull = async () => {
      try {
        const res = await sessionApi.viewShell(sessionId, {session_id: session})
        if (cancelled) return
        setPulled({key: pullKey, output: typeof res.output === 'string' ? res.output : '', error: null})
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '读取终端输出失败'
        setPulled((prev) => ({key: pullKey, output: prev?.key === pullKey ? prev.output : null, error: message}))
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 1500)
    // 断网恢复后立即重拉，不等下一次轮询
    const onOnline = () => void pull()
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [running, session, sessionId, pullKey])

  if (!call) {
    return <EmptyNote>这里会显示所选或最新的命令输出。运行命令后出现。</EmptyNote>
  }

  const rows = consoleRows(call)
  const showLive = running && (live != null || liveError != null || !session)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <p className="truncate font-mono text-xs text-muted-foreground" title={call.target || call.title}>{call.title}</p>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-terminal">
        <div className="border-b border-white/10 px-3 py-1.5 text-center font-mono text-xs text-terminal-foreground/70">
          {session || 'shell'}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 font-mono text-[13px] leading-5 text-terminal-foreground">
            {showLive && !session && (
              <p className="text-terminal-foreground/70">这次调用没有终端会话编号。长命令可能要等结束后才返回输出。</p>
            )}
            {showLive && session && liveError && (
              <p className="mb-2 text-terminal-foreground/70">暂时读不到实时输出（{liveError}），连接恢复后会自动刷新。</p>
            )}
            {showLive && session && live != null && live.length > 0 && (
              <pre className="whitespace-pre-wrap break-all">{live}</pre>
            )}
            {showLive && session && !liveError && live != null && live.length === 0 && rows.length === 0 && (
              <p className="text-terminal-foreground/70">命令还在运行。长命令可能要等结束后才返回输出。</p>
            )}
            {rows.map((row, i) => (
              <div key={i} className="mb-2">
                <div>
                  <span className="text-terminal-foreground/80">{row.ps1}</span> {row.command}
                </div>
                {row.output && <pre className="mt-0.5 whitespace-pre-wrap break-all">{row.output}</pre>}
              </div>
            ))}
            {!showLive && rows.length === 0 && (
              <p className="text-terminal-foreground/70">
                {call.status === 'running' ? '等待命令输出。' : '这次调用没有终端记录。'}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function BrowserPane({call, onOpenVnc}: {call: ToolCallView | null; onOpenVnc?: () => void}) {
  if (!call) {
    return <EmptyNote>这里会显示所选浏览器操作的截图。打开页面后出现，也可以进入远程桌面。</EmptyNote>
  }
  const src = screenshotSrc(call)
  const url = typeof call.raw.args.url === 'string' ? call.raw.args.url : call.target
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      {url && (
        <div className="flex items-center gap-2 rounded-md border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5 shrink-0" aria-hidden/>
          <span className="truncate">{url}</span>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        {src ? (
          <ScrollArea className="h-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- 沙箱截图是 data URL */}
            <img src={src} alt="浏览器截图" className="h-auto w-full"/>
          </ScrollArea>
        ) : (
          <EmptyNote>{call.status === 'running' ? '等待页面截图。' : '这次调用没有截图。'}</EmptyNote>
        )}
        {onOpenVnc && (
          <Button
            type="button"
            size="sm"
            className="absolute right-3 bottom-3"
            onClick={onOpenVnc}
          >
            <Monitor aria-hidden/>
            打开远程桌面
          </Button>
        )}
      </div>
    </div>
  )
}

function FilePreview({file}: {file: FileView}) {
  const [text, setText] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const ext = extOf(file)
  const unavailable = previewUnavailableReason(file.extension, file.size)
  const canPreview = !unavailable && (TEXT_EXT.has(ext) || IMAGE_EXT.has(ext) || ext === '.pdf')

  useEffect(() => {
    if (!canPreview) return
    let cancelled = false
    let url: string | null = null
    fileApi.downloadFile(file.id).then(async (blob) => {
      if (cancelled) return
      if (IMAGE_EXT.has(ext) || ext === '.pdf') {
        url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setImageUrl(url)
        setDone(true)
      } else {
        const body = await blob.text()
        if (cancelled) return
        setText(body)
        setDone(true)
      }
    }).catch((err: unknown) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : '预览失败')
      setDone(true)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id, ext, canPreview])

  if (unavailable) return <p className="text-xs text-faint">{unavailable}</p>
  if (canPreview && !done) return <p className="text-xs text-muted-foreground">正在读取文件</p>
  if (error) return <p className="text-xs text-state-failed">{error}</p>
  if (ext === '.pdf' && imageUrl) {
    return <iframe title={file.filename} src={imageUrl} className="h-64 w-full rounded-md border bg-card"/>
  }
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt={file.filename} className="max-h-64 rounded-md border"/>
    )
  }
  if (text != null) {
    return (
      <pre className="max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
        {text.length > 20000 ? `${text.slice(0, 20000)}…` : text}
      </pre>
    )
  }
  return <p className="text-xs text-faint">没有可显示的内容</p>
}

function FilesPane({focus, files, highlightFileId}: {focus: ToolCallView | null; files: FileView[]; highlightFileId?: string | null}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [seenHighlight, setSeenHighlight] = useState<string | null>(null)
  if (highlightFileId && highlightFileId !== seenHighlight) {
    setSeenHighlight(highlightFileId)
    setOpenId(highlightFileId)
  }
  const toolText = focus && (focus.family === 'file' || focus.family === 'deliver') ? fileBody(focus) ?? resultExcerpt(focus) : null
  const open = files.find((file) => file.id === openId) ?? null

  const download = async (file: FileView) => {
    try {
      await downloadSessionFile(file)
      toast.success(`已下载「${file.filename}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败')
    }
  }

  const downloadAll = async () => {
    for (const file of files) {
      try {
        await downloadSessionFile(file)
      } catch (err) {
        toast.error(`「${file.filename}」下载失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }
    }
    toast.success(`已下载 ${files.length} 个文件`)
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3">
        {toolText != null && focus && (
          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{focus.verb}{focus.target ? ` ${focus.target}` : ''}</h3>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
              {toolText.length > 20000 ? `${toolText.slice(0, 20000)}…` : toolText}
            </pre>
          </section>
        )}
        <section>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">会话文件</h3>
            {files.length > 1 && (
              <button
                type="button"
                onClick={() => void downloadAll()}
                className="ml-auto rounded-sm text-xs text-signal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                全部下载
              </button>
            )}
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-faint">上传的附件和交付的文件会出现在这里。现在还没有。</p>
          ) : (
            <ul className="flex flex-col">
              {files.map((file) => {
                const Icon = fileIcon(file.extension)
                const reason = previewUnavailableReason(file.extension, file.size)
                return (
                  <li key={file.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={file.filename}>{file.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{formatBytes(file.size)}</span>
                        <span className="ml-2">{file.source === 'delivery' ? '交付' : '上传'}</span>
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={reason != null}
                      title={reason ?? '预览'}
                      onClick={() => setOpenId(file.id)}
                    >
                      预览
                    </Button>
                    <Button type="button" variant="outline" size="xs" onClick={() => void download(file)}>
                      下载
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {open && (
            <div className="mt-2">
              <p className="mb-1 truncate text-xs text-muted-foreground">{open.filename}</p>
              <FilePreview file={open}/>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

/** 工作台：终端、浏览器、文件。默认跟随最新工具，手动选择后固定，直到回到最新。 */
export function Workbench({
  sessionId,
  focus,
  following,
  shellCall,
  browserCall,
  files,
  tab,
  onTab,
  highlightFileId,
  onFollowLatest,
  onClose,
  onOpenVnc,
  className,
}: WorkbenchProps) {
  const status = focus ? TOOL_STATUS[focus.status] : null
  const mismatched = focus && (
    (tab === 'terminal' && focus.family !== 'shell' && shellCall && shellCall.callId !== focus.callId) ||
    (tab === 'browser' && focus.family !== 'browser' && browserCall && browserCall.callId !== focus.callId)
  )
  const otherText = focus && focus.family !== 'shell' && focus.family !== 'browser' && focus.family !== 'file' && focus.family !== 'deliver'
    ? resultExcerpt(focus)
    : null

  return (
    <section aria-label="工作台" className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">工作台</h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {following ? '正在跟随最新操作' : '已固定查看'}
        </span>
        {!following && (
          <Button type="button" variant="outline" size="xs" onClick={onFollowLatest}>
            <Play aria-hidden/>
            回到最新
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="收起工作台">
          <PanelRightClose/>
        </Button>
      </header>
      {focus && (
        <p className="truncate border-b px-3 py-1.5 text-xs text-muted-foreground" title={focus.title}>
          {status && <span className="mr-2">{status.label}</span>}
          {focus.title}
        </p>
      )}
      <div role="tablist" aria-label="工作台内容" className="flex gap-1 border-b px-2 py-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === item.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
          >
            {item.id === 'terminal' && <Terminal className="mr-1 inline size-3.5" aria-hidden/>}
            {item.label}
          </button>
        ))}
      </div>
      {mismatched && (
        <p className="px-3 pt-2 text-xs text-faint">
          {tab === 'terminal' ? '终端显示最近一次命令，与当前固定或跟随的操作不同。' : '浏览器显示最近一次页面操作，与当前固定或跟随的操作不同。'}
        </p>
      )}
      {tab === 'terminal' && otherText && focus && focus.family !== 'shell' && (
        <pre className="mx-3 mt-2 max-h-32 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
          {otherText.slice(0, 4000)}
        </pre>
      )}
      {tab === 'terminal' && <ShellPane sessionId={sessionId} call={shellCall}/>}
      {tab === 'browser' && <BrowserPane call={browserCall} onOpenVnc={onOpenVnc}/>}
      {tab === 'files' && <FilesPane focus={focus} files={files} highlightFileId={highlightFileId}/>}
    </section>
  )
}
