import type {FileView} from '@/lib/session-view'
import {FilePreview} from './file-preview'
import {PreviewDialog} from './preview-frame'

export function FilePreviewDialog({file, onClose, onDownload}: {
  file: FileView | null
  onClose: () => void
  onDownload: (file: FileView) => void
}) {
  return <PreviewDialog title={file?.filename ?? '文件预览'} open={file != null} onClose={onClose}>
    {file && <FilePreview source={{kind: 'attachment', id: file.id, filename: file.filename, size: file.size}}
      canExpand={false} onClose={onClose} onDownload={() => onDownload(file)}/>}
  </PreviewDialog>
}
