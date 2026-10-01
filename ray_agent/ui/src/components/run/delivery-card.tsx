'use client'

import {useCallback, useEffect, useState} from 'react'
import {projectApi} from '@/lib/api/project'
import {toast} from 'sonner'
import {Download, Eye, Package} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import type {FileView} from '@/lib/session-view'
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
  const [copies, setCopies] = useState<Awaited<ReturnType<typeof projectApi.fileCopies>>>([])
  const [readError, setReadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!projectId) return
    const result = await projectApi.fileCopies(projectId)
    setCopies(result); setReadError(null)
  }, [projectId])
  useEffect(() => {
    let active = true
    setCopies([]); setReadError(null)
    if (!projectId || !files.some(file => file.projectPersistence)) return
    const read = async () => {
      try {
        const result = await projectApi.fileCopies(projectId)
        if (active) {setCopies(result); setReadError(null)}
      } catch (error) {if (active) setReadError(error instanceof Error ? error.message : '副本状态读取失败')}
    }
    void read()
    const timer = setInterval(() => {if (document.visibilityState !== 'hidden') void read()}, 5000)
    return () => {active = false; clearInterval(timer)}
  }, [projectId, files])
  const retry = async (key: string) => {
    if (!projectId || retrying) return
    setRetrying(key)
    try {await projectApi.retryDelivery(projectId, key); await refresh(); toast.success('项目副本已保存')}
    catch (error) {
      toast.error(error instanceof Error ? error.message : '副本写入失败，请重新核对状态')
      await refresh().catch(() => setReadError('请求结果未知，请重新读取副本状态'))
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
            <Download aria-hidden/>
            全部下载
          </Button>
        )}
      </header>
      {readError && <p role="alert" className="px-3.5 pt-2 text-xs text-state-failed">{readError}<Button size="xs" variant="ghost" onClick={() => void refresh().catch(error => setReadError(error instanceof Error ? error.message : '读取失败'))}>重新读取</Button></p>}
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
              {projectId && receipt?.copy_key && persistence?.can_retry && <Button size="sm" variant="outline" disabled={!!retrying || !!readError} onClick={() => void retry(receipt.copy_key)}>{retrying === receipt.copy_key ? '正在写入' : '重试项目副本'}</Button>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onPreview?.(file)}
                disabled={unavailable != null || !onPreview}
                aria-label={unavailable ? `无法预览 ${file.filename}：${unavailable}` : `预览 ${file.filename}`}
                title={unavailable ?? '预览'}
              >
                <Eye aria-hidden/>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onDownload?.(file)}
                disabled={!onDownload}
                aria-label={`下载 ${file.filename}`}
              >
                <Download aria-hidden/>
                <span className="max-sm:sr-only">下载</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
