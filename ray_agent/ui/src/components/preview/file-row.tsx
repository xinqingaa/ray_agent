'use client'

import {createElement, type ReactNode} from 'react'
import {fileIcon, previewBodyKind, previewUnavailableReason} from '@/components/run/file-icon'
import {AttachmentThumbnail} from './attachment-thumbnail'
import {formatBytes} from '@/components/run/format'
import type {FileView} from '@/lib/session-view'
import {cn} from '@/lib/utils'

/** 原生按钮覆盖整行，操作按钮作为同级元素，避免下载触发预览。 */
export function FileRow({file, onOpen, actions, children, compact = false, showThumbnail = false}: {
  file: FileView
  onOpen?: () => void
  actions?: ReactNode
  children?: ReactNode
  compact?: boolean
  showThumbnail?: boolean
}) {
  const unavailable = previewUnavailableReason(file.extension)
  if (showThumbnail && previewBodyKind(file.extension) === 'image') return <div className="min-w-0 max-w-full">
    <button type="button" aria-label="查看图片" disabled={!onOpen} onClick={onOpen}
      className="block max-w-full cursor-zoom-in rounded-lg outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
      <AttachmentThumbnail key={file.id} id={file.id} filename={file.filename}/>
    </button>
    {children}
  </div>
  return <div className={cn('group relative isolate flex min-w-0 items-center gap-2 rounded-md',
    compact ? 'max-w-full border bg-card px-2 py-1 text-xs' : 'px-2 py-2')}>
    <button type="button" aria-label={`查看 ${file.filename}`} title={file.filename} disabled={!onOpen}
      onClick={onOpen} className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"/>
    <div className={cn('pointer-events-none relative flex shrink-0 items-center justify-center',
      compact ? 'size-4' : 'size-8 rounded-md bg-muted')}>
      {createElement(fileIcon(file.extension), {className:compact ? 'size-3.5 text-muted-foreground' : 'size-4 text-muted-foreground','aria-hidden':true})}
    </div>
    <div className={cn('pointer-events-none relative min-w-0 flex-1', compact && 'flex flex-wrap items-center gap-x-1.5 gap-y-1')}>
      <span className={cn('block min-w-0 truncate group-hover:text-signal', !compact && 'text-sm font-medium')}>{file.filename}</span>
      <span className="text-xs text-muted-foreground"><span className="tabular-nums">{formatBytes(file.size)}</span>
        {unavailable && <span className="ml-2">仅下载</span>}</span>
      {children}
    </div>
    {actions && <div className="relative z-10 flex shrink-0 items-center gap-1">{actions}</div>}
  </div>
}
