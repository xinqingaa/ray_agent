'use client'

import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {useRef} from 'react'
import type {FileView} from '@/lib/session-view'
import {FilePreview} from './file-preview'

export function FilePreviewDialog({file, onClose, onDownload}: {
  file: FileView | null
  onClose: () => void
  onDownload: (file: FileView) => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  return <Dialog open={file != null} onOpenChange={open => {if (!open) onClose()}}>
    <DialogContent showCloseButton={false} ref={content} onOpenAutoFocus={event => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      event.preventDefault();content.current?.focus()
    }} onCloseAutoFocus={event => {event.preventDefault();returnFocus.current?.focus({preventScroll:true})}}
      className="flex h-[90dvh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]">
      <DialogTitle className="sr-only">{file?.filename}</DialogTitle>
      <DialogDescription className="sr-only">文件预览</DialogDescription>
      {file && <FilePreview source={{kind:'attachment',id:file.id,filename:file.filename,size:file.size}}
        canExpand={false} onClose={onClose} onDownload={() => onDownload(file)}/>}
    </DialogContent>
  </Dialog>
}
