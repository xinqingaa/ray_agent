'use client'

import {Download, Eye, Package} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import type {FileView} from '@/lib/session-view'
import {fileIcon, previewUnavailableReason} from './file-icon'
import {formatBytes} from './format'

type DeliveryCardProps = {
  files: FileView[]
  /** deliver_files 的说明 */
  note?: string
  onPreview?: (file: FileView) => void
  onDownload?: (file: FileView) => void
  onDownloadAll?: (files: FileView[]) => void
  className?: string
}

/** 交付卡：deliver_files 交付的文件，可预览、单个下载或全部下载 */
export function DeliveryCard({files, note, onPreview, onDownload, onDownloadAll, className}: DeliveryCardProps) {
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
      {note && <p className="px-3.5 pt-2 text-meta text-muted-foreground">{note}</p>}
      <ul className="p-1.5">
        {files.map((file) => {
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
              </div>
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
