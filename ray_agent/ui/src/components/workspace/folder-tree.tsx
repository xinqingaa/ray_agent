import {createElement, useRef, type KeyboardEvent} from 'react'
import {ChevronRight, Folder, FolderOpen, FileQuestion, Link2, LoaderCircle} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {fileIcon} from '@/components/run/file-icon'
import {formatBytes} from '@/components/run/format'
import {cn} from '@/lib/utils'
import {visibleRows, type TreeState} from '@/lib/workspace-tree'
import type {RootEntry} from '@/lib/api/types'

const INDENT = 14

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/** 懒加载的文件树。目录点击展开，文件点击打开预览；符号链接与特殊文件只显示，不展开不预览。 */
export function FolderTree({tree, selectedPath, onSelect, onToggle, onRetry}: {
  tree: TreeState
  selectedPath: string | null
  onSelect: (path: string, entry: RootEntry) => void
  onToggle: (path: string, expanded?: boolean) => void
  onRetry: (path: string) => void
}) {
  const rows = visibleRows(tree)
  const container = useRef<HTMLUListElement>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, path: string, entry: RootEntry, expanded: boolean) => {
    const rowsEls = container.current?.querySelectorAll<HTMLElement>('[data-tree-row]')
    const count = rowsEls?.length ?? 0
    const at = Array.from(rowsEls ?? []).indexOf(event.currentTarget)
    if (event.key === 'ArrowDown') {event.preventDefault(); if (at < count - 1) rowsEls?.[at + 1].focus()}
    else if (event.key === 'ArrowUp') {event.preventDefault(); if (at > 0) rowsEls?.[at - 1].focus()}
    else if (event.key === 'Home') {event.preventDefault(); rowsEls?.[0]?.focus()}
    else if (event.key === 'End') {event.preventDefault(); rowsEls?.[count - 1]?.focus()}
    else if (event.key === 'ArrowRight' && entry.kind === 'directory') {event.preventDefault(); if (!expanded) onToggle(path, true); else rowsEls?.[at + 1]?.focus()}
    else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (entry.kind === 'directory' && expanded) onToggle(path, false)
      else if (path.includes('/')) {
        const parent = path.slice(0, path.lastIndexOf('/'))
        const target = Array.from(rowsEls ?? []).find(el => el.dataset.treePath === parent)
        target?.focus()
      }
    }
  }

  return <ul ref={container} role="tree" aria-label="文件夹内容" className="py-1">
    {rows.map((row, index) => {
      if (row.kind === 'status') {
        const pad = {paddingLeft: row.depth * INDENT + 28}
        if (row.state === 'loading') return <li key={`s${index}`} role="none" style={pad} className="flex items-center gap-2 py-1.5 pr-3 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden/>正在读取…
        </li>
        if (row.state === 'error') return <li key={`s${index}`} role="none" style={pad} className="flex flex-wrap items-center gap-x-2 py-1.5 pr-3 text-xs text-state-failed">
          <span role="alert">{row.message ?? '读取失败'}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => onRetry(row.path)}>重试</Button>
        </li>
        if (row.state === 'empty') return <li key={`s${index}`} role="none" style={pad} className="py-1.5 pr-3 text-xs text-muted-foreground">{row.path ? '空文件夹' : '这个文件夹还是空的'}</li>
        return <li key={`s${index}`} role="none" style={pad} className="py-1.5 pr-3 text-xs text-muted-foreground">只显示前一部分条目，目录过大</li>
      }
      const {entry} = row
      const {path} = row
      const selected = selectedPath === path
      const isDirectory = entry.kind === 'directory'
      const isFile = entry.kind === 'file'
      const Icon = isDirectory ? (row.expanded ? FolderOpen : Folder) : isFile ? fileIcon(extensionOf(entry.name)) : entry.kind === 'symlink' ? Link2 : FileQuestion
      const interactive = isDirectory || isFile
      return <li key={path} role="none">
        <button type="button" role="treeitem" data-tree-row data-tree-path={path}
          aria-level={row.depth + 1} aria-selected={selected} aria-expanded={isDirectory ? row.expanded : undefined}
          aria-disabled={!interactive || undefined}
          title={entry.kind === 'symlink' ? `${entry.name} → ${entry.link_target ?? ''}` : entry.name}
          style={{paddingLeft: row.depth * INDENT + 8}}
          onClick={() => {
            if (!interactive) return
            onSelect(path, entry)
            if (isDirectory) onToggle(path)
          }}
          onKeyDown={event => onKeyDown(event, path, entry, row.expanded)}
          className={cn('flex min-h-8 w-full items-center gap-1.5 pr-3 text-left text-sm outline-none transition-colors focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
            interactive ? 'hover:bg-muted/60' : 'cursor-default text-muted-foreground',
            selected && 'bg-muted font-medium')}>
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', row.expanded && 'rotate-90', !isDirectory && 'invisible')}/>
          {createElement(Icon, {className: 'size-4 shrink-0 text-muted-foreground', 'aria-hidden': true})}
          <span className="min-w-0 flex-1 truncate" dir="auto">{entry.name}</span>
          {entry.kind === 'symlink' && <span className="shrink-0 text-xs text-muted-foreground">链接</span>}
          {entry.kind === 'other' && <span className="shrink-0 text-xs text-muted-foreground">特殊文件</span>}
          {isFile && entry.size != null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(entry.size)}</span>}
        </button>
      </li>
    })}
  </ul>
}
