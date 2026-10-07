'use client'

import {useState} from 'react'
import {projectApi} from '@/lib/api/project'
import {useProjectCopies} from './project-copy-status'
import {toast} from 'sonner'
import {Download, Eye, Package} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {cn} from '@/lib/utils'
import type {FileView, TimelineItem} from '@/lib/session-view'
import {fileIcon, previewUnavailableReason} from './file-icon'
import {formatBytes} from './format'

type DeliveryCardProps = {
  projectId?: string
  files: FileView[]
  /** deliver_files 的说明 */
  note?: string
  onPreview?: (file: FileView) => void
  onDownload?: (file: FileView) => void
  onDownloadAll?: (files: FileView[]) => void
  className?: string
}

/** 交付卡：deliver_files 交付的文件，可预览、单个下载或全部下载 */
export function DeliveryCard({projectId, files, note, onPreview, onDownload, onDownloadAll, className}: DeliveryCardProps) {
  const state = useProjectCopies()
  const copies = state?.copies ?? []
  const [retrying, setRetrying] = useState<string | null>(null)
  const retry = async (key: string) => {
    if (!projectId || retrying) return
    setRetrying(key)
    try {await projectApi.retryDelivery(projectId, key); await state?.refresh(); toast.success('项目副本已保存')}
    catch (error) {
      toast.error(error instanceof Error ? error.message : '副本写入失败，请重新核对状态')
      await state?.refresh().catch(() => {})
    } finally {setRetrying(null)}
  }
  return (
    <section aria-label="交付文件" className={cn('rounded-lg border bg-card', className)}>
      <header className="flex items-center gap-2 border-b px-3.5 py-2">
        <Package className="size-4 text-state-success" aria-hidden/>
        <h3 className="text-meta font-medium">交付 {files.length} 个文件</h3>
        {files.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => onDownloadAll?.(files)}
            disabled={!onDownloadAll}
          >
            全部下载
          </Button>
        )}
      </header>
      {note && <p className="px-3.5 pt-2 text-meta text-muted-foreground">{note}</p>}
      <ul className="p-1.5">
        {files.map((file) => {
          const receipt = file.projectPersistence
          const current = receipt && copies.find(copy => copy.copy_key === receipt.copy_key && copy.kind === 'delivery')
          const persistence = current ? {state: current.state === 'ready' && current.resolved_path?.startsWith('/workspace/') ? 'in_workspace' : current.state, path: current.path, error: current.error, can_retry: current.state !== 'ready'} : receipt
          const Icon = fileIcon(file.extension)
          const unavailable = previewUnavailableReason(file.extension, file.size)
          return (
            <li key={file.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="size-4 text-muted-foreground" aria-hidden/>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={file.path ?? file.filename}>{file.filename}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(file.size)}</span>
                  {unavailable && <span className="ml-2">{unavailable}</span>}
                </p>
                {persistence && <p className={cn('text-xs', persistence.can_retry ? 'text-state-failed' : 'text-muted-foreground')}>
                  {persistence.state === 'in_workspace' ? '项目文件引用' : persistence.state === 'ready' ? '项目副本已保存' : persistence.error ? `交付可下载，但未保存到项目：${persistence.error}` : '交付可下载，项目副本等待写入'}{persistence.path && ` · ${persistence.path}`}
                </p>}
              </div>
              {projectId && receipt?.copy_key && persistence?.can_retry && <Button size="sm" variant="outline" disabled={!!retrying || !!state?.error || !state?.loaded} onClick={() => void retry(receipt.copy_key)}>{retrying === receipt.copy_key ? '正在写入' : '重试项目副本'}</Button>}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onPreview?.(file)}
                    disabled={unavailable != null || !onPreview}
                    aria-label={unavailable ? `无法预览 ${file.filename}：${unavailable}` : `预览 ${file.filename}`}
                  >
                    <Eye aria-hidden/>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{unavailable ?? '预览'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDownload?.(file)}
                    disabled={!onDownload}
                    aria-label={`下载 ${file.filename}`}
                  >
                    <Download aria-hidden/>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>下载</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 服务已记下的交付副本。工具消息没发出时，失败副本仍要能下载并按原 key 补存。 */
export function SessionDeliveryCopies({sessionId, items, onPreview, onDownload, onDownloadAll}: {
  sessionId?: string
  items: TimelineItem[]
  onPreview?: (file: FileView) => void
  onDownload?: (file: FileView) => void
  onDownloadAll?: (files: FileView[]) => void
}) {
  const state = useProjectCopies()
  if (!state?.projectId || !sessionId || !state.loaded) return null
  const shown = new Set(items.flatMap(item => item.kind === 'delivery' ? item.files.flatMap(file => file.projectPersistence?.copy_key ? [file.projectPersistence.copy_key] : []) : []))
  const copies = state.copies.filter(copy => copy.kind === 'delivery' && copy.session_id === sessionId && copy.attachment_id && !shown.has(copy.copy_key))
  if (!copies.length) return null
  const files: FileView[] = copies.map(copy => {
    const filename = (copy.source_path || copy.path || '交付文件').split('/').pop() || '交付文件'
    const dot = filename.lastIndexOf('.')
    return {
      id: copy.attachment_id!,
      filename,
      size: copy.size ?? null,
      extension: dot > 0 ? filename.slice(dot) : '',
      contentType: '',
      source: 'delivery',
      path: copy.source_path ?? null,
      projectPersistence: {
        state: copy.state,
        copy_key: copy.copy_key,
        path: copy.path,
        error: copy.error,
        can_retry: copy.state !== 'ready',
      },
    }
  })
  return <li><DeliveryCard projectId={state.projectId} files={files} note="交付可下载。项目副本按原关联补存，不重新执行交付。" onPreview={onPreview} onDownload={onDownload} onDownloadAll={onDownloadAll}/></li>
}
