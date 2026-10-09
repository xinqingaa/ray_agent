'use client'

import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {ChevronLeft, ChevronRight, Code, Download, Expand, FileText, RefreshCw} from 'lucide-react'
import {toast} from 'sonner'
import {MarkdownContent} from '@/components/markdown-content'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {ApiError} from '@/lib/api/fetch'
import {downloadPreviewSource, previewContentUrl, previewEndpoint, readPreview, type FilePreview as Preview, type PreviewCell, type PreviewSource} from '@/lib/api/preview'
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
    color:style.color || undefined,background:style.background || undefined,textAlign:style.align || undefined,
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
        return <td key={c} colSpan={merge?.columns} rowSpan={merge?.rows} title={cell.formula || undefined}
          className="max-w-[600px] border-b border-r bg-preview-sheet px-3 py-1.5 align-middle whitespace-pre text-preview-sheet-foreground" style={cellStyle(cell)}>{cell.text}</td>
      })}</tr>)}</tbody></table></div>
}

type FilePreviewProps = {source: PreviewSource; onBack?: () => void; onDownload?: () => void; canExpand?: boolean}

export function FilePreview(props: FilePreviewProps) {
  const source=props.source
  const identity=previewEndpoint(source)+(source.kind==='project' ? `:${source.path}:${source.version ?? ''}` : '')
  return <FilePreviewContent key={identity} {...props}/>
}

function FilePreviewContent({source, onBack, onDownload, canExpand = true}: FilePreviewProps) {
  const [preview,setPreview] = useState<Preview | null>(null)
  const [error,setError] = useState<string | null>(null)
  const [errorCode,setErrorCode] = useState<number | null>(null)
  const [loading,setLoading] = useState(true)
  const [page,setPage] = useState({sheet:0,row:0,column:0,offset:0})
  const [textHistory,setTextHistory] = useState<number[]>([])
  const [reload,setReload] = useState(0)
  const [expanded,setExpanded] = useState(false)
  const [raw,setRaw] = useState(false)
  const revision = useRef<string | null>(null)
  const epoch = useRef(0)
  const endpoint = previewEndpoint(source)
  const path = source.kind==='project' ? source.path : ''
  const version = source.kind==='project' ? source.version : undefined
  useEffect(() => {
    const controller=new AbortController(), counter=epoch, token=++counter.current
    const params=new URLSearchParams(path ? {path} : {})
    Object.entries(page).forEach(([key,value])=>params.set(key,String(value)))
    if(revision.current)params.set('revision',revision.current)
    readPreview(endpoint,params,controller.signal).then(result=> {
      if(token!==epoch.current)return
      revision.current=result.revision;setPreview(result)
    }).catch(error=> {
      if(token!==epoch.current || controller.signal.aborted)return
      setPreview(null);setError(error instanceof Error ? error.message : '读取失败');setErrorCode(error instanceof ApiError ? error.code : null)
    }).finally(()=> {if(token===epoch.current)setLoading(false)})
    return ()=> {counter.current++;controller.abort()}
  },[endpoint,path,version,page,reload])
  const changePage = (next: typeof page) => {setLoading(true);setError(null);setErrorCode(null);setPage(next)}
  const refresh = () => {setLoading(true);setError(null);setErrorCode(null);revision.current=null;setPage({sheet:0,row:0,column:0,offset:0});setTextHistory([]);setReload(value=>value+1)}
  const download = () => {
    if(onDownload)onDownload()
    else void downloadPreviewSource(source).catch(error=>toast.error(error instanceof Error ? error.message : '下载失败'))
  }
  const filename=preview?.filename || source.filename
  const contentUrl=previewContentUrl(source,preview?.revision)
  const body = (full = false) => {
    if(loading)return <p className="p-4 text-xs text-muted-foreground" role="status">正在读取</p>
    if(error)return <div className="p-4"><p role="alert" className="text-xs text-state-failed">{errorCode===410 ? '图片已过期' : error}</p>
      {errorCode!==410 && <Button variant="ghost" size="sm" onClick={refresh}>{errorCode===409 ? '刷新' : '重试'}</Button>}</div>
    if(!preview)return null
    if(preview.kind==='unavailable')return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <FileText className="size-8 text-muted-foreground" aria-hidden/><p className="text-sm">{preview.reason || '暂不支持预览'}</p>
      <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(preview.size)}</span><Button variant="outline" size="sm" onClick={download}><Download/>下载</Button></div>
    if(preview.kind==='image')return <ImagePreview src={preview.thumbnail || contentUrl} originalSrc={contentUrl} title={filename} onDownload={download} mode={full || !canExpand ? 'canvas' : 'thumbnail'}
      dimensions={preview.width && preview.height ? `${preview.width} × ${preview.height}` : undefined}/>
    if(preview.kind==='pdf')return <iframe title={filename} src={contentUrl} className="h-full w-full border-0 bg-card"/>
    if(preview.kind==='table')return <TablePreview key={`${preview.sheet}:${preview.row}:${preview.column}`} preview={preview}/>
    const text=preview.content ?? ''
    if(preview.kind==='markdown' && !raw)return <div className="h-full overflow-auto p-4"><MarkdownContent content={text}/></div>
    let formatted=text
    if(!preview.partial && source.filename.toLowerCase().endsWith('.json') && !raw) {
      try {formatted=JSON.stringify(JSON.parse(text),null,2)} catch {/* 保留原文 */}
    }
    return <div className="h-full overflow-auto"><pre className="p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">{formatted}</pre></div>
  }
  const navigation = preview && (preview.kind==='table' || preview.next_offset!=null || textHistory.length>0) && <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1">
    {preview.kind==='table' ? <>
      <span className="mr-auto text-xs tabular-nums text-muted-foreground">{(preview.row ?? 0)+1}–{(preview.row ?? 0)+(preview.rows?.length ?? 0)} 行</span>
      <PreviewAction label="上一组列" icon={ChevronLeft} disabled={loading || page.column===0} onClick={()=>changePage({...page,column:Math.max(0,page.column-50)})}/>
      <span className="text-xs text-muted-foreground">列</span><PreviewAction label="下一组列" icon={ChevronRight} disabled={loading || preview.next_column==null} onClick={()=>changePage({...page,column:preview.next_column!})}/>
      <PreviewAction label="上一页" icon={ChevronLeft} disabled={loading || page.row===0} onClick={()=>changePage({...page,row:Math.max(0,page.row-200)})}/>
      <PreviewAction label="下一页" icon={ChevronRight} disabled={loading || preview.next_row==null} onClick={()=>changePage({...page,row:preview.next_row!})}/>
    </> : <><span className="mr-auto text-xs text-muted-foreground">部分预览</span><PreviewAction label="上一段" icon={ChevronLeft} disabled={loading || !textHistory.length}
      onClick={()=> {const previous=textHistory.at(-1)!;setTextHistory(textHistory.slice(0,-1));changePage({...page,offset:previous})}}/>
      <PreviewAction label="下一段" icon={ChevronRight} disabled={loading || preview.next_offset==null}
        onClick={()=> {setTextHistory([...textHistory,page.offset]);changePage({...page,offset:preview.next_offset!})}}/></>}
  </footer>
  const toolbar = <>
    {preview?.partial && <span className="shrink-0 text-xs text-muted-foreground">部分预览</span>}
    {preview?.cells_truncated && <span className="shrink-0 text-xs text-muted-foreground">内容截断</span>}
    {preview?.formula_missing && <span className="shrink-0 text-xs text-muted-foreground" title="部分公式没有已保存的计算结果">公式未计算</span>}
    {(preview?.kind==='markdown' || source.filename.toLowerCase().endsWith('.json')) && <PreviewAction label={raw ? '格式化阅读' : '查看原文'} icon={raw ? FileText : Code} pressed={raw} onClick={()=>setRaw(!raw)}/>}
    <PreviewAction label="刷新预览" icon={RefreshCw} disabled={loading} onClick={refresh}/>
    <PreviewAction label={`下载 ${preview?.filename || source.filename}`} icon={Download} disabled={errorCode===410} onClick={download}/>
  </>
  const sheetTabs = !!preview?.sheets?.length && <div className="shrink-0 overflow-x-auto border-b px-2 py-1"><div role="tablist" aria-label="工作表" className="flex w-max gap-1">
    {preview.sheets.map((sheet,i)=><button key={i} type="button" role="tab" aria-selected={page.sheet===i} disabled={loading}
      className={`rounded-md px-3 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${page.sheet===i ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
      onClick={()=>changePage({sheet:i,row:0,column:0,offset:0})}>{sheet}</button>)}</div></div>
  return <section aria-label={`预览 ${source.filename}`} className="flex h-full min-h-0 flex-col">
    <header className={`flex shrink-0 items-center gap-1 border-b px-2 py-1 ${!canExpand ? 'pr-12' : ''}`}>
      {onBack && <PreviewAction label="返回文件列表" icon={ChevronLeft} onClick={onBack}/>}
      {canExpand ? <button type="button" aria-label={`展开 ${filename}`} className="mr-auto min-w-0 cursor-pointer truncate rounded-sm text-left text-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring" title={filename} onClick={()=>setExpanded(true)}>{filename}</button>
        : <span className="mr-auto min-w-0 truncate text-sm" title={filename}>{filename}</span>}{toolbar}
      {canExpand && preview?.kind!=='image' && <PreviewAction label="展开预览" icon={Expand} onClick={()=>setExpanded(true)}/>}
    </header>
    {sheetTabs}
    <div className="min-h-0 flex-1">{body()}</div>{navigation}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="flex h-[90dvh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]">
      <DialogTitle className="sr-only">{filename}</DialogTitle><DialogDescription className="sr-only">文件预览</DialogDescription>
      <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2 pr-12"><span className="mr-auto min-w-0 truncate text-sm">{filename}</span>{toolbar}</header>
      {sheetTabs}<div className="min-h-0 flex-1">{body(true)}</div>{navigation}
    </DialogContent></Dialog>
  </section>
}
