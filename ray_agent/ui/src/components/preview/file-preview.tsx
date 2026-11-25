import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react'
import {ChevronLeft, ChevronRight, Code, Download, ExternalLink, FileText, Finder, Globe, MoreHorizontal, RefreshCw} from '@/components/ui/icons'
import {toast} from 'sonner'
import {MarkdownContent} from '@/components/markdown-content'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {PreviewDialog, PreviewFrame} from './preview-frame'
import {WebPreview} from './web-preview'
import {ApiError} from '@/lib/api/fetch'
import type {ManagedPreview} from '@/lib/api/managed-previews'
import type {ErrorCode} from '@/lib/api/types'
import {canDownload, downloadPreviewSource, isWebPage, openPreviewTab, previewContentUrl, previewEndpoint, readPreview, type FilePreview as Preview, type FilePreviewSource, type PreviewCell, type PreviewLocation, type PreviewSource, type WordBlock} from '@/lib/api/preview'
import {fileManagerName, isDesktop, revealInFileManager} from '@/lib/platform'
import {cn} from '@/lib/utils'
import {formatBytes} from '@/components/run/format'
import {PreviewAction} from './action'
import {ImagePreview} from './image-preview'

function columnName(index: number) {
  let name = ''
  for (let n=index+1;n>0;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name
  return name
}

function cellStyle(cell: PreviewCell): CSSProperties {
  const style = cell.style
  return style ? {fontWeight:style.bold ? 600 : undefined,fontStyle:style.italic ? 'italic' : undefined,
    color:cell.uncached ? undefined : style.color || undefined,background:cell.uncached ? undefined : style.background || undefined,textAlign:style.align || undefined,
    whiteSpace:style.wrap ? 'pre-wrap' : 'pre',
    borderTopWidth:style.borders?.[0] ? 1 : undefined,borderRightWidth:style.borders?.[1] ? 1 : undefined,
    borderBottomWidth:style.borders?.[2] ? 1 : undefined,borderLeftWidth:style.borders?.[3] ? 1 : undefined} : {}
}

function TablePreview({preview}: {preview: Preview}) {
  const merges = preview.merges ?? []
  const covered = new Set<string>()
  const starts = new Map(merges.map(merge => [`${merge.row}:${merge.column}`,merge]))
  for (const merge of merges) for(let r=merge.row;r<merge.row+merge.rows;r++) for(let c=merge.column;c<merge.column+merge.columns;c++) {
    if(r!==merge.row || c!==merge.column) covered.add(`${r}:${c}`)
  }
  return <div className="h-full overflow-auto"><table aria-label={preview.sheets?.[preview.sheet ?? 0] || preview.filename}
    className="border-separate border-spacing-0 text-xs tabular-nums">
    <colgroup><col style={{width:40}}/>{preview.widths?.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
    <thead className="sticky top-0 z-10"><tr><th className="sticky left-0 border-b border-r bg-muted px-2 py-1.5"/>
      {preview.widths?.map((_,i)=><th key={i} scope="col" className="border-b border-r bg-muted px-3 py-1.5 text-center font-normal text-muted-foreground">{columnName((preview.column ?? 0)+i)}</th>)}
    </tr></thead><tbody>{preview.rows?.map((row,r)=><tr key={r}>
      <th scope="row" className="sticky left-0 border-b border-r bg-muted px-2 py-1.5 text-center font-normal text-muted-foreground">{(preview.row ?? 0)+r+1}</th>
      {row.map((cell,c)=> {
        if(covered.has(`${r}:${c}`))return null
        const merge=starts.get(`${r}:${c}`)
        const uncached = Boolean(cell.uncached)
        return <td key={c} colSpan={merge?.columns} rowSpan={merge?.rows}
          data-uncached-formula={uncached ? 'true' : undefined}
          title={uncached ? `未保存计算结果的公式：${cell.formula || cell.text}（用表格软件打开后可重算）` : cell.formula || undefined}
          className={cn(
            'max-w-[600px] border-b border-r px-3 py-1.5 align-middle whitespace-pre',
            uncached
              ? 'bg-state-waiting-soft/45 font-mono italic text-muted-foreground'
              : 'bg-preview-sheet text-preview-sheet-foreground',
          )}
          style={cellStyle(cell)}>{cell.text}</td>
      })}</tr>)}</tbody></table></div>
}

function DocxPreview({blocks, location}: {blocks: WordBlock[]; location?: PreviewLocation}) {
  const entries: ReactNode[] = []
  let list: {tag: 'ol' | 'ul'; first: number; items: ReactNode[]} | undefined
  const flush = () => {
    if (!list) return
    const {tag: Tag, first, items} = list
    entries.push(<Tag key={`list-${first}`} className={Tag === 'ol' ? 'list-decimal pl-6' : 'list-disc pl-6'}>{items}</Tag>)
    list = undefined
  }
  for (const block of blocks) {
    if (block.kind === 'table') {
      flush()
      entries.push(<div key={`table-${block.table}`} className="overflow-x-auto">
        <table aria-label={`表格 ${block.table + 1}`} className="w-full border-collapse text-left text-sm"
          style={{outline: block.table === location?.table ? '1px solid var(--signal)' : undefined}}>
          <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) =>
            <td key={j} className="border border-preview-sheet-foreground/20 px-2.5 py-1.5 whitespace-pre-wrap wrap-anywhere">{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>)
      continue
    }
    const spans = block.spans.map((span, i) => 'image' in span
      ? <img key={i} alt="文档内图片" src={span.image} className="my-2 block max-h-[65vh] max-w-full object-contain"/>
      : <span key={i} style={{fontWeight: span.bold ? 600 : undefined, fontStyle: span.italic ? 'italic' : undefined}}>{span.text}</span>)
    const selected = block.block === location?.block ? 'rounded bg-signal-soft' : undefined
    if (block.list_type) {
      const tag = block.list_type === 'number' ? 'ol' : 'ul'
      if (list?.tag !== tag) flush()
      list ??= {tag, first: block.block, items: []}
      list.items.push(<li key={block.block} className={selected}>{spans}</li>)
      continue
    }
    flush()
    if (block.kind === 'heading') {
      entries.push(<div key={block.block} role="heading" aria-level={Math.min(block.level ?? 1, 6)}
        className={`font-semibold ${(block.level ?? 1) === 1 ? 'text-lg' : 'text-base'} ${selected ?? ''}`}>{spans}</div>)
    } else entries.push(<div key={block.block} className={selected}>{spans.length ? spans : <br/>}</div>)
  }
  flush()
  return <div className="h-full overflow-auto bg-preview-sheet text-preview-sheet-foreground">
    <div className="mx-auto max-w-[46rem] space-y-3 px-5 py-5 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
      {entries.length ? entries : <p>文档没有正文。</p>}
    </div>
  </div>
}

type FilePreviewProps = {
  source: PreviewSource
  onBack?: () => void
  backLabel?: string
  onDownload?: () => void
  onClose?: () => void
  canExpand?: boolean
  onReveal?: () => void
  onOpenAsSite?: () => void
  onPreviewChange?: (preview: ManagedPreview) => void
  onPreviewDeleted?: (previewId: string) => void
  onAskAgentFix?: (prompt: string) => void
  onRevealManaged?: (preview: ManagedPreview) => void
}

export function FilePreview(props: FilePreviewProps) {
  const {source} = props
  const identity = source.kind === 'managed'
    ? ['managed', source.previewId]
    : source.kind === 'root_dir'
      ? ['root_dir', source.rootId, source.path, source.entryPath ?? '']
      : source.kind === 'root'
        ? [previewEndpoint(source), source.location, source.expectedRevision]
        : [previewEndpoint(source)]
  return <FilePreviewInner key={JSON.stringify(identity)} {...props}/>
}

function FilePreviewInner(props: FilePreviewProps) {
  const {
    source, onBack, backLabel, onDownload, onClose, canExpand = true, onReveal, onOpenAsSite,
    onPreviewChange, onPreviewDeleted, onAskAgentFix, onRevealManaged,
  } = props
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  if (source.kind === 'managed') {
    return (
      <WebPreview
        source={source}
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        canExpand={canExpand}
        onPreviewChange={onPreviewChange}
        onPreviewDeleted={onPreviewDeleted}
        onAskAgentFix={onAskAgentFix}
        onRevealManaged={onRevealManaged}
      />
    )
  }
  const webSource = source.kind === 'root_dir' || isWebPage(source.filename)
  if (source.kind === 'root_dir' || (webSource && viewMode === 'preview')) {
    return <WebPreview source={source} onBack={onBack} backLabel={backLabel} onDownload={onDownload} onClose={onClose}
      canExpand={canExpand} onReveal={onReveal} onOpenAsSite={source.kind === 'root' ? onOpenAsSite : undefined}
      onViewSource={source.kind !== 'root_dir' ? () => setViewMode('source') : undefined}/>
  }
  return <FilePreviewContent source={source} onBack={onBack} backLabel={backLabel} onDownload={onDownload} onClose={onClose}
    canExpand={canExpand} onReveal={onReveal} onOpenWebPreview={webSource ? () => setViewMode('preview') : undefined}/>
}

function FilePreviewContent({source, onBack, backLabel, onDownload, onClose, canExpand = true, onReveal, onOpenWebPreview}: {
  source: FilePreviewSource
  onBack?: () => void
  backLabel?: string
  onDownload?: () => void
  onClose?: () => void
  canExpand?: boolean
  onReveal?: () => void
  onOpenWebPreview?: () => void
}) {
  const location = source.kind === 'root' ? source.location : undefined
  const expectedRevision = source.kind === 'root' ? source.expectedRevision : undefined
  const firstPage = {sheet:0,row:0,column:0,offset:0,...location}
  const [preview,setPreview] = useState<Preview | null>(null)
  const [error,setError] = useState<string | null>(null)
  const [errorCode,setErrorCode] = useState<ErrorCode | null>(null)
  const [loading,setLoading] = useState(true)
  const [page,setPage] = useState(firstPage)
  const [textHistory,setTextHistory] = useState<typeof firstPage[]>([])
  const [reload,setReload] = useState(0)
  const [expanded,setExpanded] = useState(false)
  const [raw,setRaw] = useState(false)
  const revision = useRef<string | null>(expectedRevision ?? null)
  const epoch = useRef(0)
  const endpoint = previewEndpoint(source)
  const [content,setContent] = useState<{revision: string; url: string} | null>(null)
  useEffect(() => {
    const controller=new AbortController(), counter=epoch, token=++counter.current
    const params=new URLSearchParams()
    Object.entries(page).forEach(([key,value])=> {if (value != null) params.set(key,String(value))})
    if(revision.current)params.set('revision',revision.current)
    readPreview(endpoint,params,controller.signal).then(result=> {
      if(token!==epoch.current)return
      revision.current=result.revision;setPreview(result)
    }).catch(error=> {
      if(token!==epoch.current || controller.signal.aborted)return
      setPreview(null);setError(error instanceof Error ? error.message : '读取失败');setErrorCode(error instanceof ApiError ? error.code : null)
    }).finally(()=> {if(token===epoch.current)setLoading(false)})
    return ()=> {counter.current++;controller.abort()}
  },[endpoint,page,reload])
  const needsContent = preview?.kind==='image'
  const contentRevision = needsContent ? preview.revision : null
  useEffect(() => {
    if(contentRevision==null)return
    let active=true
    previewContentUrl(source,contentRevision).then(url=> {if(active)setContent({revision:contentRevision,url})})
      .catch(error=> {if(active){setError(error instanceof Error ? error.message : '读取失败');setErrorCode(error instanceof ApiError ? error.code : null)}})
    return ()=> {active=false}
  },[endpoint,contentRevision,reload]) // eslint-disable-line react-hooks/exhaustive-deps -- source 与 endpoint 一一对应
  const changePage = (next: typeof page) => {setLoading(true);setError(null);setErrorCode(null);setPage(next)}
  const refresh = () => {setLoading(true);setError(null);setErrorCode(null);revision.current=expectedRevision ?? null;setPage(firstPage);setTextHistory([]);setReload(value=>value+1)}
  const download = () => {
    if(onDownload)onDownload()
    else void downloadPreviewSource(source).catch(error=>toast.error(error instanceof Error ? error.message : '下载失败'))
  }
  const reveal = onReveal ?? (source.kind === 'root' && isDesktop()
    ? () => void revealInFileManager(source.rootId, source.path).catch(err => toast.error(err instanceof Error ? err.message : '无法显示位置'))
    : undefined)
  const filename=preview?.filename || source.filename
  const contentUrl=content && content.revision===preview?.revision ? content.url : null
  const body = (full = false) => {
    if(loading)return <p className="p-4 text-xs text-muted-foreground" role="status">正在读取</p>
    if(error)return <div className="p-4"><p role="alert" className="text-xs text-state-failed">{errorCode==='gone' ? '图片已过期' : error}</p>
      {errorCode!=='gone' && !(errorCode==='conflict' && expectedRevision) && <Button variant="ghost" size="sm" onClick={refresh}>{errorCode==='conflict' ? '刷新' : '重试'}</Button>}</div>
    if(!preview)return null
    if(preview.kind==='unavailable')return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <FileText className="size-8 text-muted-foreground" aria-hidden/><p className="text-sm wrap-anywhere">{preview.reason || '暂不支持预览'}</p>
      <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(preview.size)}</span>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {preview.reason?.startsWith('预览处理') && <Button variant="outline" size="sm" onClick={refresh}>重试</Button>}
        {reveal && <Button variant="outline" size="sm" onClick={reveal}><Finder/>在 {fileManagerName()} 中显示</Button>}
        {canDownload(source) && <Button variant="outline" size="sm" onClick={download}><Download/>下载</Button>}
      </div></div>
    if(preview.kind==='image' && !preview.thumbnail && !contentUrl)return <p className="p-4 text-xs text-muted-foreground" role="status">正在读取</p>
    if(preview.kind==='image')return <ImagePreview src={preview.thumbnail || contentUrl!} originalSrc={contentUrl ?? undefined} title={filename} onDownload={canDownload(source) ? download : undefined} mode={full || !canExpand ? 'canvas' : 'thumbnail'} onExpand={() => setExpanded(true)}
      dimensions={preview.width && preview.height ? `${preview.width} × ${preview.height}` : undefined}/>
    if(preview.kind==='pdf')return <div className="h-full overflow-auto bg-muted p-2.5">
      {preview.thumbnail ? <img alt={`${filename} 第 ${preview.page} 页`} src={preview.thumbnail}
        className="mx-auto block max-w-full bg-preview-sheet shadow-sm"
        onError={() => setError('PDF 页面图像读取失败')}/> : <p role="alert" className="p-2 text-meta">PDF 页面读取失败</p>}
    </div>
    if(preview.kind==='docx')return <DocxPreview blocks={preview.blocks ?? []} location={location}/>
    if(preview.kind==='table')return <TablePreview key={`${preview.sheet}:${preview.row}:${preview.column}`} preview={preview}/>
    const text=preview.content ?? ''
    if(preview.kind==='markdown' && !raw)return <div className="h-full overflow-auto p-4"><MarkdownContent content={text}/></div>
    let formatted=text
    if(!preview.partial && source.filename.toLowerCase().endsWith('.json') && !raw) {
      try {formatted=JSON.stringify(JSON.parse(text),null,2)} catch {/* 保留原文 */}
    }
    return <div className="h-full overflow-auto"><pre className="p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">{formatted}</pre></div>
  }
  const navigation = preview && (preview.kind==='pdf' || preview.kind==='table' || preview.next_offset!=null || textHistory.length>0) && <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1">
    {preview.kind==='pdf' ? <>
      <span className="mr-auto text-xs tabular-nums text-muted-foreground">第 {preview.page} / {preview.page_count} 页</span>
      <PreviewAction label="上一页" icon={ChevronLeft} disabled={loading || (preview.page ?? 1) <= 1}
        onClick={()=>changePage({...page,page:(preview.page ?? 1)-1})}/>
      <PreviewAction label="下一页" icon={ChevronRight} disabled={loading || (preview.page ?? 1) >= (preview.page_count ?? 1)}
        onClick={()=>changePage({...page,page:(preview.page ?? 1)+1})}/>
    </> : preview.kind==='table' ? <>
      <span className="mr-auto text-xs tabular-nums text-muted-foreground">{(preview.row ?? 0)+1}–{(preview.row ?? 0)+(preview.rows?.length ?? 0)} 行</span>
      <PreviewAction label="上一组列" icon={ChevronLeft} disabled={loading || page.column===0} onClick={()=>changePage({...page,column:Math.max(0,page.column-50)})}/>
      <span className="text-xs text-muted-foreground">列</span><PreviewAction label="下一组列" icon={ChevronRight} disabled={loading || preview.next_column==null} onClick={()=>changePage({...page,column:preview.next_column!})}/>
      <PreviewAction label="上一页" icon={ChevronLeft} disabled={loading || page.row===0} onClick={()=>changePage({...page,row:Math.max(0,page.row-200)})}/>
      <PreviewAction label="下一页" icon={ChevronRight} disabled={loading || preview.next_row==null} onClick={()=>changePage({...page,row:preview.next_row!})}/>
    </> : <><span className="mr-auto text-xs text-muted-foreground">部分预览</span><PreviewAction label="上一段" icon={ChevronLeft} disabled={loading || !textHistory.length}
      onClick={()=> {const previous=textHistory.at(-1)!;setTextHistory(textHistory.slice(0,-1));changePage(previous)}}/>
      <PreviewAction label="下一段" icon={ChevronRight} disabled={loading || preview.next_offset==null}
        onClick={()=> {setTextHistory([...textHistory,page]);changePage({...page,block:undefined,table:undefined,offset:preview.next_offset!})}}/></>}
  </footer>
  const canReadRaw = preview?.kind === 'markdown' || source.filename.toLowerCase().endsWith('.json')
  const actions = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="预览操作" className="text-muted-foreground"><MoreHorizontal aria-hidden/></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {onOpenWebPreview && <DropdownMenuItem onSelect={onOpenWebPreview}><Globe/>运行预览</DropdownMenuItem>}
      {canReadRaw && <DropdownMenuItem onSelect={() => setRaw(!raw)}>{raw ? <FileText/> : <Code/>}{raw ? '格式化阅读' : '查看原文'}</DropdownMenuItem>}
      {isWebPage(source.filename) && <DropdownMenuItem onSelect={() => void openPreviewTab(source).catch(error => toast.error(error instanceof Error ? error.message : '打开失败'))}><ExternalLink/>在系统浏览器中打开</DropdownMenuItem>}
      <DropdownMenuItem disabled={loading} onSelect={refresh}><RefreshCw/>刷新预览</DropdownMenuItem>
      {reveal && <DropdownMenuItem onSelect={reveal}><Finder/>在 {fileManagerName()} 中显示</DropdownMenuItem>}
      {canDownload(source) && <DropdownMenuItem disabled={errorCode === 'gone'} onSelect={download}><Download/>下载</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
  const notes = [
    preview?.kind === 'image' ? formatBytes(preview.size) : null,
    preview?.partial ? '部分预览' : null,
    preview?.cells_truncated ? '内容截断' : null,
    preview?.content_limited ? '部分内容超出预览范围，可查看原件' : null,
  ].filter(Boolean)
  const selectedSheet = preview?.sheet ?? page.sheet
  const sheetTabs = !!preview?.sheets?.length && <div className="shrink-0 overflow-x-auto border-b px-2 py-1"><div role="tablist" aria-label="工作表" className="flex w-max gap-1">
    {preview.sheets.map((sheet,i)=><button key={i} type="button" role="tab" aria-selected={selectedSheet===i} disabled={loading}
      className={`rounded-md px-3 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedSheet===i ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
      onClick={()=>changePage({sheet:i,row:0,column:0,offset:0})}>{sheet}</button>)}</div></div>
  const formulaBanner = preview?.kind === 'table' && preview.formula_missing && <div
    role="status"
    data-uncached-formula-banner="true"
    className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-state-waiting-soft/70 px-3 py-2 text-xs"
  >
    <span className="min-w-0 flex-1 wrap-anywhere">
      此表包含未保存计算结果的公式（已用等宽灰字标出），请用外部表格软件打开重算后再保存。
    </span>
    {reveal && <Button type="button" variant="outline" size="xs" onClick={reveal}><Finder/>在 {fileManagerName()} 中显示</Button>}
    {canDownload(source) && <Button type="button" variant="outline" size="xs" onClick={download}><Download/>下载原件</Button>}
  </div>
  const reader = (full = false) => <>
    {sheetTabs}
    {formulaBanner}
    <div className="min-h-0 flex-1">{body(full)}</div>
    {navigation}
    {!!notes.length && <p className="shrink-0 border-t px-3 py-1.5 text-xs tabular-nums text-faint">{notes.join(' · ')}</p>}
  </>
  return <>
    <PreviewFrame filename={filename} actions={actions} onBack={onBack} backLabel={backLabel} onClose={onClose}
      onExpand={canExpand ? () => setExpanded(true) : undefined}>
      {reader()}
    </PreviewFrame>
    <PreviewDialog title={filename} open={expanded} onClose={() => setExpanded(false)}>
      <PreviewFrame filename={filename} actions={actions} onClose={() => setExpanded(false)}>{reader(true)}</PreviewFrame>
    </PreviewDialog>
  </>
}
