import {Download, ExternalLink, Eye, Package, PackageOpen} from 'lucide-react'
import {isWebPage} from '@/lib/api/preview'
import {PreviewAction} from '@/components/preview/action'
import {cn} from '@/lib/utils'
import type {FileView} from '@/lib/session-view'
import {previewBodyKind, previewUnavailableReason} from './file-icon'
import {FileRow} from '@/components/preview/file-row'

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
  const images = files.filter(file => previewBodyKind(file.extension) === 'image')
  const documents = files.filter(file => previewBodyKind(file.extension) !== 'image')
  const renderFiles = (items: FileView[]) => items.map((file) => {
    const unavailable = previewUnavailableReason(file.extension)
    return (
      <li key={file.id}>
        <FileRow file={file} showThumbnail onOpen={onPreview ? () => onPreview(file) : undefined} actions={<>
          {!unavailable && <PreviewAction label={isWebPage(file.filename) ? `在浏览器中打开 ${file.filename}` : `预览 ${file.filename}`} icon={isWebPage(file.filename) ? ExternalLink : Eye} onClick={() => onPreview?.(file)} disabled={!onPreview}/>}
          <PreviewAction label={`下载 ${file.filename}`} icon={Download} onClick={() => onDownload?.(file)} disabled={!onDownload}/>
        </>}/>
      </li>
    )
  })
  return <div className={cn('min-w-0 space-y-3', className)}>
    {images.length > 0 && <ul aria-label="交付图片" className="flex flex-wrap items-start gap-3">{renderFiles(images)}</ul>}
    {documents.length > 0 && <section aria-label="交付文件" className="rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3.5 py-2">
        <Package className="size-4 text-state-success" aria-hidden/>
        <h3 className="text-meta font-medium">交付 {documents.length} 个文件</h3>
        {documents.length > 1 && <span className="ml-auto"><PreviewAction label={`打包下载 ${documents.length} 个交付文件`} icon={PackageOpen} onClick={() => onDownloadAll?.(documents)} disabled={!onDownloadAll}/></span>}
      </header>
      {note && <p className="px-3.5 pt-2 text-meta text-muted-foreground">{note}</p>}
      <ul className="p-1.5">{renderFiles(documents)}</ul>
    </section>}
  </div>
}
