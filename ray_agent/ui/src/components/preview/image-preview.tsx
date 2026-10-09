'use client'

import {useRef, useState} from 'react'
import {Download, Expand, Minus, Plus, Scan, SquareDashed} from 'lucide-react'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {PreviewAction} from './action'

function ImageCanvas({src, title, scale}: {src: string; title: string; scale: number | null}) {
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null)
  const [failed,setFailed] = useState(false)
  if(failed)return <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-state-failed">图片加载失败<button type="button" className="rounded-sm px-2 py-1 text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setFailed(false)}>重试</button></div>
  return <div ref={area} className="flex min-h-0 flex-1 overflow-auto bg-muted/40 p-4"
    onPointerDown={event => {
      if (scale == null || event.button !== 0 || !area.current) return
      drag.current = {x:event.clientX,y:event.clientY,left:area.current.scrollLeft,top:area.current.scrollTop}
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (!drag.current || !area.current) return
      area.current.scrollLeft = drag.current.left - event.clientX + drag.current.x
      area.current.scrollTop = drag.current.top - event.clientY + drag.current.y
    }} onPointerUp={() => {drag.current=null}} onPointerCancel={() => {drag.current=null}}>
    {/* eslint-disable-next-line @next/next/no-img-element -- 文件与截图共用的原图查看 */}
    <img src={src} alt={title} draggable={false} onError={()=>setFailed(true)} className={scale == null ? 'm-auto max-h-full max-w-full object-contain' : 'm-auto max-w-none shrink-0 cursor-grab self-start'}
      style={scale == null ? undefined : {zoom:scale}}/>
  </div>
}

type ImagePreviewProps = {
  src: string; originalSrc?: string; title: string; onDownload?: () => void; onError?: () => void; dimensions?: string; mode?: 'thumbnail' | 'canvas'
}

export function ImagePreview(props: ImagePreviewProps) {
  return <ImagePreviewContent key={props.src} {...props}/>
}

function ImagePreviewContent({src, originalSrc, title, onDownload, onError, dimensions, mode = 'thumbnail'}: ImagePreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [scale, setScale] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const expandedSrc = originalSrc || src
  const controls = <>
    <PreviewAction label="适应窗口" icon={Scan} pressed={scale==null} onClick={() => setScale(null)}/>
    <PreviewAction label="缩小" icon={Minus} onClick={() => setScale(value => Math.max(.1,(value ?? 1)-.25))}/>
    <PreviewAction label="放大" icon={Plus} onClick={() => setScale(value => Math.min(4,(value ?? 1)+.25))}/>
    <PreviewAction label="原始尺寸" icon={SquareDashed} pressed={scale===1} onClick={() => setScale(1)}/>
  </>
  if (mode === 'canvas') return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
      {dimensions && <span className="mr-auto text-xs tabular-nums text-muted-foreground">{dimensions}</span>}{controls}
    </div>
    <ImageCanvas src={expandedSrc} title={title} scale={scale}/>
  </div>
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-end gap-1 px-2 py-1">
      {dimensions && <span className="mr-auto text-xs tabular-nums text-muted-foreground">{dimensions}</span>}
      <PreviewAction label="放大查看" icon={Expand} onClick={() => setExpanded(true)} disabled={failed}/>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {failed ? <div className="flex items-center gap-2 p-3 text-xs"><p role="alert" className="text-state-failed">图片加载失败</p><button type="button" className="rounded-sm px-2 py-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setFailed(false)}>重试</button></div> : <button type="button" aria-label={`放大 ${title}`}
        className="block w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 只读图片缩略图 */}
        <img src={src} alt={title} className="mx-auto h-auto max-w-full rounded-md" onError={() => {setFailed(true);onError?.()}}/>
      </button>}
    </div>
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent className="flex h-[90dvh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]">
        <DialogTitle className="sr-only">{title}</DialogTitle><DialogDescription className="sr-only">图片预览</DialogDescription>
        <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2 pr-12">
          <span className="mr-auto min-w-0 truncate text-sm">{title}</span>
          {controls}
          {onDownload && <PreviewAction label={`下载 ${title}`} icon={Download} onClick={onDownload}/>} 
        </header>
        <ImageCanvas src={expandedSrc} title={title} scale={scale}/>
      </DialogContent>
    </Dialog>
  </div>
}
