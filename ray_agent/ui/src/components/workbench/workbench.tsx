import {ChevronLeft, Download, ExternalLink, Eye, Files, Globe, PackageOpen} from '@/components/ui/icons'
import {useState} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import type {FileView, ToolCallView} from '@/lib/session-view'
import {toast} from 'sonner'
import {previewUnavailableReason} from '@/components/run/file-icon'
import {FileRow} from '@/components/preview/file-row'
import {FilePreview} from '@/components/preview/file-preview'
import {ImagePreview} from '@/components/preview/image-preview'
import {PreviewAction} from '@/components/preview/action'
import {PreviewFrame} from '@/components/preview/preview-frame'
import {downloadFileBatch, downloadPreviewSource, isWebPage, openPreviewTab, saveImage} from '@/lib/api/preview'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
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
  return <p className="px-4 py-5 text-meta text-faint">{children}</p>
}

function ResultPane({call, rawResults}: {call: ToolCallView; rawResults: boolean}) {
  const body = rawResults ? resultExcerpt(call) : call.family === 'file' && call.name === 'read_file' ? fileBody(call) : null
  const plan = call.family === 'plan' && Array.isArray(call.raw.args.plan) ? call.raw.args.plan : null
  return <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-sm leading-relaxed">
    {call.result?.error && <p className="wrap-anywhere text-state-failed">{call.result.error}</p>}
    {call.result?.summary && <p className="wrap-anywhere">{call.result.summary}</p>}
    {body ? <pre className="font-mono text-xs whitespace-pre-wrap wrap-anywhere">{body.slice(0, 20000)}{body.length > 20000 ? '…' : ''}</pre>
      : plan ? <ol className="list-decimal space-y-1 pl-5">{plan.map((item, index) => {
        const step = asRecord(item)
        return <li key={index}>{typeof step?.step === 'string' ? step.step : '未命名步骤'}</li>
      })}</ol>
      : !call.result?.error && !call.result?.summary && <p className="text-muted-foreground">
        {call.status === 'running' ? '正在处理，结果将在完成后显示。' : '这一步没有可显示的结果。'}
      </p>}
    {body && body.length > 20000 && <p className="text-xs text-muted-foreground">结果较长，这里只显示前 20,000 字符。</p>}
    {rawResults && call.result?.truncated && call.result.fullOutputPath && <p className="text-xs text-muted-foreground">
      完整输出保存在 <span className="font-mono wrap-anywhere">{call.result.fullOutputPath}</span>
    </p>}
  </div>
}

function ShellPane({call}: {call: ToolCallView}) {
  const rows = consoleRows(call)
  const fallback = rows.length === 0 ? resultExcerpt(call) : null
  const command = call.raw.args.command
  const terminalSession = call.raw.args.session_id ?? call.raw.args.shell_session_id
  const exitCode = call.result?.exitCode
  return <div className="space-y-2 rounded-xl bg-muted/60 p-3 font-mono text-xs leading-5">
    {!rows.length && typeof command === 'string' && <pre className="whitespace-pre-wrap wrap-anywhere">$ {command}</pre>}
    {call.result?.error && <p className="wrap-anywhere">{call.result.error}</p>}
    {rows.map((row, index) => <div key={index}>
      {row.command && <p className="whitespace-pre-wrap wrap-anywhere">{row.ps1} {row.command}</p>}
      {row.output && <pre className="mt-1 whitespace-pre-wrap wrap-anywhere">{row.output}</pre>}
    </div>)}
    {fallback && <pre className="whitespace-pre-wrap wrap-anywhere">{fallback.slice(0, 20000)}{fallback.length > 20000 ? '…' : ''}</pre>}
    {!rows.length && !fallback && !call.result?.error && <p className="opacity-70">
      {call.status === 'running' ? '等待命令输出。' : '这次调用没有终端记录。'}
    </p>}
    {(exitCode != null || typeof terminalSession === 'string') && <div className="flex flex-wrap justify-between gap-x-2 text-faint">
      {exitCode != null && <span className="tabular-nums">退出码 {exitCode}</span>}
      {typeof terminalSession === 'string' && <span className="min-w-0 wrap-anywhere">终端会话 {terminalSession}</span>}
    </div>}
    {call.result?.truncated && call.result.fullOutputPath && <p className="wrap-anywhere opacity-70">完整输出 {call.result.fullOutputPath}</p>}
  </div>
}

function BrowserPane({call}: {call: ToolCallView}) {
  const {visibility} = useDeveloperMode()
  const content = asRecord(call.raw.content)
  const data = asRecord(asRecord(content?.outcome)?.data)
  const src = screenshotSrc(call)
  const fileId = typeof data?.file_id === 'string' ? data.file_id : src?.match(/^\/api\/files\/([^/?#]+)/)?.[1]
  const url = typeof content?.url === 'string' ? content.url : typeof call.raw.args.url === 'string' ? call.raw.args.url : null
  const fallback = !src ? visibility.rawResults ? resultExcerpt(call) : typeof content?.content === 'string' ? content.content : typeof data?.content === 'string' ? data.content : null : null
  const observationError = typeof data?.observation_error === 'string' ? data.observation_error : null
  return <div className="flex min-h-0 flex-1 flex-col">
    {observationError && <p role="alert" className="px-3 py-2 text-xs text-state-failed">页面内容读取失败：{observationError}</p>}
    {url && <div className="flex shrink-0 items-center gap-2 px-3 pb-2 text-xs text-muted-foreground"><Globe className="size-3.5 shrink-0" aria-hidden/>
      {/^https?:\/\//.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-signal" title={url}>{url}</a> : <span className="truncate">{url}</span>}</div>}
    {fileId ? <FilePreview key={fileId} source={{kind:'attachment',id:fileId,filename:'浏览器截图.png'}}/>
      : src ? <PreviewFrame filename="浏览器截图.png">
        <ImagePreview key={call.callId} src={src} title="浏览器截图" onDownload={() => void saveImage(src, src.startsWith('data:image/jpeg') ? '浏览器截图.jpg' : '浏览器截图.png').catch(error => toast.error(error instanceof Error ? error.message : '保存失败'))}/>
      </PreviewFrame>
      : fallback ? <ScrollArea className="min-h-0 flex-1 px-3"><pre className="rounded-xl bg-muted/60 p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere">{fallback.length>20000 ? `${fallback.slice(0,20000)}…` : fallback}</pre></ScrollArea>
      : <EmptyNote>{call.result?.error ?? (call.status==='running' ? '正在读取页面' : '没有截图')}</EmptyNote>}
  </div>
}

function FilesPane({files, onBack}: {files: FileView[]; onBack: () => void}) {
  const [openId,setOpenId] = useState<string | null>(null)
  const [packing,setPacking] = useState(false)
  const open = files.find(file => file.id===openId)
  const download = async (file: FileView) => {
    try {await downloadSessionFile(file)} catch(error) {toast.error(error instanceof Error ? error.message : '下载失败')}
  }
  const downloadAll = async () => {
    if(packing)return
    setPacking(true)
    try {await downloadFileBatch(files.filter(file => file.source === 'delivery'))} catch(error) {toast.error(error instanceof Error ? error.message : '打包失败')}
    finally {setPacking(false)}
  }
  if(open)return <FilePreview key={open.id} source={{kind:'attachment',id:open.id,filename:open.filename,size:open.size}}
    onBack={() => setOpenId(null)} onDownload={() => void download(open)}/>
  return <>
    <div className="flex items-center gap-1 px-3">
      <PreviewAction label="返回步骤结果" icon={ChevronLeft} onClick={onBack}/>
      <h3 className="text-sm font-medium">会话文件</h3>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
    {(['delivery','upload'] as const).map(source => {
      const group = files.filter(file => source === 'delivery' ? file.source === 'delivery' : file.source !== 'delivery')
      return <section key={source}><header className="mb-2 flex items-center gap-2"><h3 className="mr-auto text-sm font-medium">{source==='delivery' ? '交付结果' : '输入材料'}</h3>
        {source==='delivery' && group.length>0 && <PreviewAction label={packing ? '正在打包' : '下载本次交付'} icon={PackageOpen} disabled={packing} onClick={() => void downloadAll()}/>}</header>
        {!group.length ? <p className="py-3 text-xs text-muted-foreground">{source==='delivery' ? '本次对话尚未交付文件。' : '本次对话没有上传附件。'}</p> : <ul className="flex flex-wrap gap-2">{group.map(file => {
          const reason=previewUnavailableReason(file.extension)
          const page=isWebPage(file.filename)
          const inspect=() => {
            if(page)return void openPreviewTab({kind:'attachment',id:file.id,filename:file.filename,size:file.size}).catch(error=>toast.error(error instanceof Error ? error.message : '打开失败'))
            setOpenId(file.id)
          }
          return <li className="min-w-0 w-full" key={file.id}><FileRow file={file} showThumbnail onOpen={inspect} actions={<>
            {!reason && <PreviewAction label={page ? `在浏览器中打开 ${file.filename}` : `预览 ${file.filename}`} icon={page ? ExternalLink : Eye} onClick={inspect}/>}<PreviewAction label={`下载 ${file.filename}`} icon={Download} onClick={() => void download(file)}/>
          </>}/></li>
        })}</ul>}
      </section>
    })}
  </div></ScrollArea>
  </>
}

/** 「查看」直接呈现所选步骤。会话文件通过独立入口打开。 */
export function Workbench({focus, files, canFollowLatest, onFollowLatest}: {
  focus: ToolCallView | null
  files: FileView[]
  canFollowLatest: boolean
  onFollowLatest: () => void
}) {
  const {visibility} = useDeveloperMode()
  const [showFiles, setShowFiles] = useState(false)
  return <section aria-label="查看结果" className="flex h-full min-h-0 flex-col">
    {showFiles ? <FilesPane files={files} onBack={() => setShowFiles(false)}/> : <>
      {(focus || files.length > 0 || canFollowLatest) && <div className="flex min-h-9 shrink-0 items-center gap-1 px-3">
        {focus && <h3 className="mr-auto min-w-0 truncate text-xs text-muted-foreground" title={focus.title}>
          {focus.family === 'shell' ? '终端' : focus.target ? `${focus.verb} · ${focus.target}` : focus.verb}
        </h3>}
        {canFollowLatest && <Button type="button" variant="ghost" size="xs" onClick={onFollowLatest} className="ml-auto text-muted-foreground">查看最新结果</Button>}
        {files.length > 0 && <PreviewAction label="会话文件" icon={Files} onClick={() => setShowFiles(true)}/>}
      </div>}
      {!focus ? <EmptyNote>选择一个对话步骤查看结果。</EmptyNote>
        : focus.family === 'browser' ? <BrowserPane key={focus.callId} call={focus}/>
        : <ScrollArea className="min-h-0 flex-1"><div className="px-3 pb-3">
          {focus.family === 'shell' && visibility.terminal ? <ShellPane call={focus}/> : <ResultPane call={focus} rawResults={visibility.rawResults}/>}
        </div></ScrollArea>}
    </>}
  </section>
}
