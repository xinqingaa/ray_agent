import {useRef, type ReactNode} from 'react'
import {ChevronLeft, Expand, X} from '@/components/ui/icons'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {FileTypeBadge, fileExtension} from '@/components/run/file-icon'
import {PreviewAction} from './action'

export function PreviewFrame({filename, children, actions, onBack, onExpand, onClose}: {
  filename: string
  children: ReactNode
  actions?: ReactNode
  onBack?: () => void
  onExpand?: () => void
  onClose?: () => void
}) {
  return <section aria-label={`预览 ${filename}`} className="flex h-full min-h-0 flex-col gap-2 px-3 pt-1 pb-3">
    <header className="flex min-h-9 shrink-0 items-center gap-1.5">
      {onBack && <PreviewAction label="返回文件列表" icon={ChevronLeft} onClick={onBack}/>}
      <FileTypeBadge extension={fileExtension(filename)} compact/>
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={filename} dir="auto">{filename}</h2>
      {actions}
      {onExpand && <PreviewAction label="放大预览" icon={Expand} onClick={onExpand}/>}
      {onClose && <PreviewAction label="关闭预览" icon={X} onClick={onClose}/>}
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card">{children}</div>
  </section>
}

export function PreviewDialog({title, open, onClose, children}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  return <Dialog open={open} onOpenChange={next => {if (!next) onClose()}}>
    <DialogContent showCloseButton={false} ref={content} onOpenAutoFocus={event => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      event.preventDefault()
      content.current?.focus()
    }} onCloseAutoFocus={event => {
      event.preventDefault()
      returnFocus.current?.focus({preventScroll: true})
    }} className="flex h-[min(50rem,calc(100dvh-2rem))] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-[20px] bg-background p-2 shadow-(--float-shadow) sm:w-[calc(100%-3rem)] sm:max-w-5xl sm:p-3">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">文件预览</DialogDescription>
      {children}
    </DialogContent>
  </Dialog>
}
