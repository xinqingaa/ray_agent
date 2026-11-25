import type {ManagedPreview} from '@/lib/api/managed-previews'
import type {PreviewSource} from '@/lib/api/preview'
import type {FileView} from '@/lib/session-view'
import {FilePreview} from './file-preview'
import {PreviewDialog} from './preview-frame'

export function FilePreviewDialog({
  file,
  source,
  onClose,
  onDownload,
  onPreviewChange,
  onPreviewDeleted,
  onAskAgentFix,
}: {
  file?: FileView | null
  source?: PreviewSource | null
  onClose: () => void
  onDownload?: (file: FileView) => void
  onPreviewChange?: (preview: ManagedPreview) => void
  onPreviewDeleted?: (previewId: string) => void
  onAskAgentFix?: (prompt: string) => void
}) {
  const resolved: PreviewSource | null = source ?? (file
    ? {kind: 'attachment', id: file.id, filename: file.filename, size: file.size}
    : null)
  const title = file?.filename
    ?? (resolved?.kind === 'managed' ? (resolved.initial?.name ?? '项目预览')
      : resolved?.kind === 'root_dir' ? resolved.title
        : resolved?.kind === 'root' || resolved?.kind === 'attachment' ? resolved.filename
          : '文件预览')

  return <PreviewDialog title={title} open={resolved != null} onClose={onClose}>
    {resolved && <FilePreview
      source={resolved}
      canExpand={false}
      onClose={onClose}
      onDownload={file && onDownload ? () => onDownload(file) : undefined}
      onPreviewChange={onPreviewChange}
      onPreviewDeleted={id => {onPreviewDeleted?.(id); onClose()}}
      onAskAgentFix={prompt => {onAskAgentFix?.(prompt); onClose()}}
    />}
  </PreviewDialog>
}
