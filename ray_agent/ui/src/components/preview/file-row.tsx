import type {MouseEventHandler, ReactNode} from 'react'
import {FileTypeBadge, previewBodyKind, previewUnavailableReason} from '@/components/run/file-icon'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {copyText} from '@/lib/clipboard'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {Copy, Download, Eye} from '@/components/ui/icons'
import {AttachmentThumbnail} from './attachment-thumbnail'
import {formatBytes} from '@/components/run/format'
import type {FileView} from '@/lib/session-view'
import {cn} from '@/lib/utils'

/**
 * 原生按钮覆盖整行，操作按钮作为同级元素，避免下载触发预览。
 * `menu` 为右键菜单项，由调用方按文件可用的动作组装；没有项时右键交给外层。
 */
export function FileRow({file, onOpen, actions, children, compact = false, showThumbnail = false, versionLabel, menu}: {
  file: FileView
  onOpen?: () => void
  actions?: ReactNode
  children?: ReactNode
  compact?: boolean
  showThumbnail?: boolean
  versionLabel?: string
  menu?: MenuEntry[]
}) {
  const unavailable = previewUnavailableReason(file.extension)
  const open: MouseEventHandler<HTMLButtonElement> = event => {
    event.currentTarget.focus({preventScroll: true})
    onOpen?.()
  }
  if (showThumbnail && previewBodyKind(file.extension) === 'image') return <ContextMenuSurface items={menu ?? []}><div className="min-w-0 max-w-full">
    <button type="button" aria-label="查看图片" disabled={!onOpen} onClick={open}
      className="block max-w-full cursor-zoom-in rounded-lg outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
      <AttachmentThumbnail key={file.id} id={file.id} filename={file.filename}/>
    </button>
    {children}
  </div></ContextMenuSurface>
  return <ContextMenuSurface items={menu ?? []}><div className={cn('group relative isolate flex min-w-0 items-center gap-2 rounded-md',
    compact ? 'max-w-full border bg-card px-2 py-1 text-xs' : 'px-2 py-2')}>
    <button type="button" aria-label={`查看 ${file.filename}`} title={file.filename} disabled={!onOpen}
      onClick={open} className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"/>
    <div className="pointer-events-none relative flex shrink-0 items-center justify-center"><FileTypeBadge extension={file.extension} compact={compact || !!versionLabel}/></div>
    <div className={cn('pointer-events-none relative min-w-0 flex-1', compact && 'flex flex-wrap items-center gap-x-1.5 gap-y-1')}>
      <span className={cn('block min-w-0 truncate group-hover:text-signal', !compact && 'text-sm', !versionLabel && !compact && 'font-medium')}>{file.filename}</span>
      {!versionLabel && <span className="text-xs text-muted-foreground"><span className="tabular-nums">{formatBytes(file.size)}</span>
        {unavailable && <span className="ml-2">仅下载</span>}</span>}
      {children}
    </div>
    {versionLabel && <span className="pointer-events-none relative shrink-0 text-xs text-faint">{versionLabel}</span>}
    {actions && <div className="relative z-10 flex shrink-0 items-center gap-1">{actions}</div>}
  </div></ContextMenuSurface>
}

/** 文件行的标准菜单项：预览、下载、复制文件名。只给出可用的项。 */
export function fileMenuEntries(file: FileView, {onPreview, onDownload}: {onPreview?: (file: FileView) => void; onDownload?: (file: FileView) => void}): MenuEntry[] {
  const unavailable = previewUnavailableReason(file.extension)
  return [
    ...(onPreview && !unavailable ? [menuItem('预览', Eye, () => onPreview(file))] : []),
    ...(onDownload ? [menuItem('下载', Download, () => onDownload(file))] : []),
    menuItem('复制文件名', Copy, () => copyText(file.filename)),
  ]
}
