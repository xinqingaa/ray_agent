import {ChevronRight, Folder, FolderOpen, Link2, LoaderCircle, FileQuestion} from '@/components/ui/icons'
import {createElement, useRef, type KeyboardEvent} from 'react'
import {Button} from '@/components/ui/button'
import {fileExtension, FileTypeBadge} from '@/components/run/file-icon'
import {formatBytes} from '@/components/run/format'
import {cn} from '@/lib/utils'
import {visibleRows, type TreeState} from '@/lib/workspace-tree'
import type {RootEntry} from '@/lib/api/types'

const INDENT = 14
const INDEX_LABEL: Record<string, string> = {
  searchable: '可检索', pending_component: '待文字识别', failed: '索引失败',
  registered: '等待索引', pending_parse: '等待解析', parsing: '正在解析', indexing: '正在索引',
}

/** 懒加载的文件树。目录点击展开，文件点击打开预览；符号链接与特殊文件只显示，不展开不预览。 */
export function FolderTree({tree, selectedPath, indexStates, readPaths, addedPaths, onSelect, onToggle, onRetry}: {
  tree: TreeState
  selectedPath: string | null
  indexStates?: ReadonlyMap<string, string>
  readPaths?: ReadonlySet<string>
  addedPaths?: ReadonlySet<string>
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
      const Icon = isDirectory ? (row.expanded ? FolderOpen : Folder) : entry.kind === 'symlink' ? Link2 : FileQuestion
      const interactive = isDirectory || isFile
      const status = isFile ? indexStates?.get(path) : undefined
      const indexLabel = status ? INDEX_LABEL[status] : undefined
      const read = isFile && readPaths?.has(path)
      const fresh = isFile && addedPaths?.has(path)
      return <li key={path} role="none">
        <button type="button" role="treeitem" data-tree-row data-tree-path={path}
          aria-level={row.depth + 1} aria-selected={selected} aria-expanded={isDirectory ? row.expanded : undefined}
          aria-disabled={!interactive || undefined}
          title={entry.kind === 'symlink' ? `${entry.name} → ${entry.link_target ?? ''}` :
            [entry.name, isFile && entry.size != null ? formatBytes(entry.size) : null, indexLabel].filter(Boolean).join(' · ')}
          style={{paddingLeft: row.depth * INDENT + (isFile && row.depth > 0 ? 16 : 8)}}
          onClick={() => {
            if (!interactive) return
            onSelect(path, entry)
            if (isDirectory) onToggle(path)
          }}
          onKeyDown={event => onKeyDown(event, path, entry, row.expanded)}
          className={cn('flex min-h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-sm outline-none transition-colors focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
            interactive ? 'hover:bg-muted/60' : 'cursor-default text-muted-foreground',
            isDirectory && 'font-medium text-muted-foreground',
            selected && 'bg-muted font-medium')}>
          {isDirectory && <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-faint transition-transform motion-reduce:transition-none', row.expanded && 'rotate-90')}/>}
          {isFile ? <FileTypeBadge extension={fileExtension(entry.name)}/> : createElement(Icon, {className: 'size-4 shrink-0 text-muted-foreground', 'aria-hidden': true})}
          <span className="min-w-0 flex-1 truncate" dir="auto">{entry.name}</span>
          {entry.kind === 'symlink' && <span className="shrink-0 text-xs text-muted-foreground">链接</span>}
          {entry.kind === 'other' && <span className="shrink-0 text-xs text-muted-foreground">特殊文件</span>}
          {read && <span className="folder-row-tag bg-signal-soft text-signal">本次读取</span>}
          {fresh && <span className="folder-row-tag bg-state-success-soft text-state-success">新</span>}
          {indexLabel && <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="folder-index-dot" data-index={status} aria-hidden/>
            <span className={cn(status === 'searchable' && 'sr-only')}>{indexLabel}</span>
          </span>}
        </button>
      </li>
    })}
  </ul>
}
