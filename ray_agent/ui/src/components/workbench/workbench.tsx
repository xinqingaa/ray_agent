'use client'

import {useEffect, useState} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Download, Eye, Globe, PackageOpen, PanelRight, Play, Terminal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {fileApi} from '@/lib/api/file'
import {sessionApi} from '@/lib/api/session'
import type {FileView, ToolCallView, ToolFamily} from '@/lib/session-view'
import {cn} from '@/lib/utils'
import {toast} from 'sonner'
import {previewUnavailableReason} from '@/components/run/file-icon'
import {FileRow} from '@/components/preview/file-row'
import {TOOL_STATUS} from '@/components/run/status-meta'
import type {ProjectView} from '@/lib/session-view'
import {ManagedProjectPane} from '@/components/workbench/managed-project-pane'
import {FilePreview} from '@/components/preview/file-preview'
import {ImagePreview} from '@/components/preview/image-preview'
import {PreviewAction} from '@/components/preview/action'
import {downloadFileBatch, downloadPreviewSource, startDownload} from '@/lib/api/preview'

export type WorkbenchTab = 'result' | 'terminal' | 'browser' | 'files' | 'project'

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
  onInspectFile?: () => void
  onFollowLatest: () => void
  canFollowLatest?: boolean
  active?: boolean
  onClose: () => void
  project?: ProjectView | null
  projectRefreshSignal?: number
  className?: string
}

const TABS: Array<{id: WorkbenchTab; label: string}> = [
  {id: 'result', label: '结果'},
  {id: 'terminal', label: '终端'},
  {id: 'browser', label: '浏览器'},
  {id: 'files', label: '文件'},
]

export function tabForFamily(family: ToolFamily): WorkbenchTab {
  if (family === 'shell') return 'terminal'
  if (family === 'browser') return 'browser'
  if (family === 'file' || family === 'deliver') return 'files'
  return 'result'
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
  if (raw.startsWith('/api/files/')) return fileApi.getFileDownloadUrl(raw.split('/')[3])
  if (raw.startsWith('/')) return raw
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


export async function downloadSessionFile(file: FileView) {
  await downloadPreviewSource({kind:'attachment',id:file.id,filename:file.filename})
}

function EmptyNote({children}: {children: string}) {
  return <p className="px-4 py-8 text-center text-meta text-faint">{children}</p>
}

/** 没有专属终端、浏览器或文件视图的工具，直接展示该次调用的结果。 */
function ResultPane({call}: {call: ToolCallView}) {
  const body = resultExcerpt(call)
  const plan = call.family === 'plan' && Array.isArray(call.raw.args.plan) ? call.raw.args.plan : null
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-3">
        {call.result?.error && <p className="text-sm text-state-failed">{call.result.error}</p>}
        {call.result?.summary && <p className="text-xs text-muted-foreground">{call.result.summary}</p>}
        {body ? (
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
            {body.length > 20000 ? `${body.slice(0, 20000)}…` : body}
          </pre>
        ) : plan ? (
          <ol className="space-y-2 text-sm">
            {plan.map((item, index) => {
              const step = asRecord(item)
              return <li key={index} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
                <span>{typeof step?.step === 'string' ? step.step : '未命名步骤'}</span>
              </li>
            })}
          </ol>
        ) : !call.result?.error && !call.result?.summary && (
          <p className="py-6 text-center text-meta text-faint">
            {call.status === 'running' ? '等待工具返回结果。' : '这次调用没有可显示的结果。'}
          </p>
        )}
        {body && body.length > 20000 && <p className="text-xs text-muted-foreground">结果较长，这里只显示前 20,000 字符。</p>}
        {call.result?.truncated && call.result.fullOutputPath && (
          <p className="text-xs text-muted-foreground">完整输出保存在 {call.result.fullOutputPath}</p>
        )}
      </div>
    </ScrollArea>
  )
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
  const fallback = rows.length === 0 ? resultExcerpt(call) : null
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
            {call.result?.error && (
              <p className="mb-2 text-state-failed">{call.result.error}</p>
            )}
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
            {fallback && <pre className="whitespace-pre-wrap break-all">{fallback.length > 20000 ? `${fallback.slice(0, 20000)}…` : fallback}</pre>}
            {!showLive && rows.length === 0 && !fallback && !call.result?.error && (
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

function BrowserPane({call}: {call: ToolCallView | null}) {
  const {visibility} = useDeveloperMode()
  if (!call) return <EmptyNote>选择浏览器操作</EmptyNote>
  const content = asRecord(call.raw.content)
  const data = asRecord(asRecord(content?.outcome)?.data)
  const src = screenshotSrc(call)
  const fileId = typeof data?.file_id === 'string' ? data.file_id : src?.match(/\/files\/([^/]+)\/download/)?.[1]
  const url = typeof content?.url === 'string' ? content.url : typeof call.raw.args.url === 'string' ? call.raw.args.url : null
  const fallback = !src ? visibility.rawResults ? resultExcerpt(call) : typeof content?.content === 'string' ? content.content : typeof data?.content === 'string' ? data.content : null : null
  const observationError = typeof data?.observation_error === 'string' ? data.observation_error : null
  return <div className="flex min-h-0 flex-1 flex-col">
    {observationError && <p role="alert" className="px-3 py-2 text-xs text-state-failed">页面内容读取失败：{observationError}</p>}
    {url && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground"><Globe className="size-3.5 shrink-0" aria-hidden/>
      {/^https?:\/\//.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-signal" title={url}>{url}</a> : <span className="truncate">{url}</span>}</div>}
    {fileId ? <FilePreview key={fileId} source={{kind:'attachment',id:fileId,filename:'浏览器截图.png'}}/>
      : src ? <ImagePreview key={call.callId} src={src} title="浏览器截图" onDownload={()=>startDownload(src,src.startsWith('data:image/jpeg') ? '浏览器截图.jpg' : '浏览器截图.png')}/>
      : fallback ? <ScrollArea className="min-h-0 flex-1"><pre className="p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">{fallback.length>20000 ? `${fallback.slice(0,20000)}…` : fallback}</pre></ScrollArea>
      : <EmptyNote>{call.result?.error ?? (call.status==='running' ? '正在读取页面' : '没有截图')}</EmptyNote>}
  </div>
}

function FilesPane({focus, files, onInspectFile}: {focus: ToolCallView | null; files: FileView[]; onInspectFile?: () => void}) {
  const {visibility} = useDeveloperMode()
  const [openId,setOpenId] = useState<string | null>(null)
  const [packing,setPacking] = useState(false)
  const open = files.find(file => file.id===openId)
  const download = async (file: FileView) => {
    try {await downloadSessionFile(file)} catch(error) {toast.error(error instanceof Error ? error.message : '下载失败')}
  }
  const downloadAll = async () => {
    if(packing)return
    setPacking(true)
    try {await downloadFileBatch(files)} catch(error) {toast.error(error instanceof Error ? error.message : '打包失败')}
    finally {setPacking(false)}
  }
  if(open)return <FilePreview key={open.id} source={{kind:'attachment',id:open.id,filename:open.filename,size:open.size}}
    onBack={() => setOpenId(null)} onDownload={() => void download(open)}/>
  const toolText = visibility.rawResults && focus?.family==='file' ? fileBody(focus) : null
  return <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
    {focus?.family==='file' && focus.result?.error && <p className="text-xs text-state-failed">{focus.result.error}</p>}
    {toolText && <section><p className="mb-1 truncate text-xs text-muted-foreground">{focus?.target}</p><pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{toolText.slice(0,20000)}</pre></section>}
    <section><header className="mb-1 flex items-center gap-2"><h3 className="mr-auto text-xs font-medium text-muted-foreground">会话文件</h3>
      {files.length>1 && <PreviewAction label={packing ? '正在打包' : `打包下载全部 ${files.length} 个文件`} icon={PackageOpen} disabled={packing} onClick={() => void downloadAll()}/>}</header>
      {!files.length ? <p className="py-6 text-center text-xs text-muted-foreground">暂无文件</p> : <ul>{files.map(file => {
        const reason=previewUnavailableReason(file.extension)
        const inspect=() => {onInspectFile?.();setOpenId(file.id)}
        return <li key={file.id}><FileRow file={file} onOpen={inspect} actions={<>
          {!reason && <PreviewAction label={`预览 ${file.filename}`} icon={Eye} onClick={inspect}/>}<PreviewAction label={`下载 ${file.filename}`} icon={Download} onClick={() => void download(file)}/>
        </>}><span className="ml-2 text-xs text-muted-foreground">{file.source==='delivery' ? '交付' : '上传'}</span></FileRow>
        </li>
      })}</ul>}
    </section>
  </div></ScrollArea>
}

/** 工作台按当前工具展示结果、终端、浏览器或文件，手动选择后可固定。 */
export function Workbench({
  sessionId,
  focus,
  following,
  shellCall,
  browserCall,
  files,
  tab: requestedTab,
  onTab,
  onInspectFile,
  onFollowLatest,
  canFollowLatest = true,
  active = true,
  onClose,
  project,
  projectRefreshSignal,
  className,
}: WorkbenchProps) {
  const {visibility} = useDeveloperMode()
  const tab = visibility.canShowWorkbenchTab(requestedTab) ? requestedTab : 'files'
  const status = focus ? TOOL_STATUS[focus.status] : null
  const mismatched = focus && (
    (tab === 'terminal' && focus.family !== 'shell' && shellCall && shellCall.callId !== focus.callId) ||
    (tab === 'browser' && focus.family !== 'browser' && browserCall && browserCall.callId !== focus.callId)
  )
  const hasResultTab = focus && !['shell', 'browser', 'file', 'deliver'].includes(focus.family)
  const hasProject = project != null
  const availableTabs = [
    ...TABS.filter((item) =>
      item.id === 'files' ||
      (item.id === 'result' && visibility.rawResults && hasResultTab) ||
      (item.id === 'terminal' && visibility.terminal && shellCall) ||
      (item.id === 'browser' && browserCall),
    ),
    ...(hasProject ? [{id: 'project' as const, label: '项目'}] : []),
  ]

  return (
    <section aria-label={visibility.developerView ? '工作台' : '结果与资料'} className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="mr-auto text-sm font-medium">{visibility.developerView ? '工作台' : '结果与资料'}</h2>
        {!following && (visibility.developerView || canFollowLatest) && (
          <Button type="button" variant="outline" size="xs" onClick={onFollowLatest}>
            <Play aria-hidden/>
            {visibility.developerView ? '回到最新' : '查看最新结果'}
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onClose} aria-label="收起工作台" title="收起工作台">
          <PanelRight className="size-4"/>
        </Button>
      </header>
      {focus && tab !== 'files' && (visibility.toolDetails || focus.status !== 'succeeded') && (
        <p className="truncate border-b px-3 py-1.5 text-xs text-muted-foreground" title={focus.title}>
          {status && (visibility.toolDetails || focus.status !== 'succeeded') && <span className="mr-2">{status.label}</span>}
          {focus.title}
        </p>
      )}
      <div role="tablist" aria-label="工作台内容" className="flex gap-1 border-b px-2 py-1">
        {availableTabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`workbench-tab-${item.id}`}
            aria-controls={tab === item.id ? `workbench-panel-${item.id}` : undefined}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTab(item.id)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? availableTabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % availableTabs.length : (index - 1 + availableTabs.length) % availableTabs.length
              const id = availableTabs[next].id
              onTab(id)
              document.getElementById(`workbench-tab-${id}`)?.focus()
            }}
            className={cn(
              'rounded-md px-2.5 py-1 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === item.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
          >
            {item.id === 'terminal' && <Terminal className="mr-1 inline size-3.5" aria-hidden/>}
            {item.id === 'browser' && !visibility.developerView ? '页面内容' : item.label}
          </button>
        ))}
      </div>
      {mismatched && (
        <p className="px-3 pt-2 text-xs text-faint">
          {tab === 'terminal' ? '终端显示最近一次命令，与当前固定或跟随的操作不同。' : '浏览器显示最近一次页面操作，与当前固定或跟随的操作不同。'}
        </p>
      )}
      <div role="tabpanel" id={`workbench-panel-${tab}`} aria-labelledby={`workbench-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
      {tab === 'result' && hasResultTab && <ResultPane call={focus}/>}
      {tab === 'terminal' && active && <ShellPane sessionId={sessionId} call={shellCall}/>}
      {tab === 'browser' && <BrowserPane call={browserCall}/>}
      {tab === 'files' && <FilesPane focus={focus} files={files} onInspectFile={onInspectFile}/>}
      {tab === 'project' && hasProject && project?.available && (
        <ManagedProjectPane key={project.id} projectId={project.id} refreshSignal={projectRefreshSignal}/>
      )}
      {tab === 'project' && hasProject && !project?.available && (
        <EmptyNote>{project.reason ?? '项目目录不可用'}</EmptyNote>
      )}
      </div>
    </section>
  )
}
