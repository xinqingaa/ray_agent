import {Ban, ChevronRight, Copy, Eye, Finder, Folder, FolderOpen, FolderPlus, Layers, Link2, LoaderCircle, FileQuestion, Pencil, Plus, Trash} from '@/components/ui/icons'
import {createElement, Fragment, useRef, type KeyboardEvent} from 'react'
import {Button} from '@/components/ui/button'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {fileExtension, FileTypeBadge} from '@/components/run/file-icon'
import {formatBytes} from '@/components/run/format'
import {cn} from '@/lib/utils'
import {uploadTarget, visibleRows, type TreeState} from '@/lib/workspace-tree'
import {entryActionsFor, type EntryEdit} from '@/lib/workspace-entries'
import {directoryIndexAction, fileIndexAction} from '@/lib/document-index-policy'
import type {IndexSummary} from '@/lib/api/documents'
import {fileManagerName} from '@/lib/platform'
import type {RootEntry} from '@/lib/api/types'
import {EntryNameInput} from './entry-name-input'

const INDENT = 14
const INDEX_LABEL: Record<string, string> = {
  searchable: '可检索', pending_component: '待文字识别', failed: '索引失败',
  registered: '等待索引', pending_parse: '等待解析', parsing: '正在解析', indexing: '正在索引',
}

/**
 * 懒加载的文件树。目录点击展开，文件点击打开预览；符号链接与特殊文件只显示，不展开不预览。
 * 条目操作（重命名、新建文件夹、删除）由面板提供回调；有回调时行菜单才出现对应项。编辑中的名称在行内输入。
 */
export function FolderTree({tree, selectedPath, indexStates, indexSummary, readPaths, addedPaths, onSelect, onToggle, onRetry, onReveal, onAdd,
  edit, editBusy, onEditChange, onEditCommit, onEditCancel, onStartRename, onStartCreate, onRequestDelete, onCopyPath,
  onToggleFileIndex, onToggleDirectoryIndex}: {
  tree: TreeState
  selectedPath: string | null
  indexStates?: ReadonlyMap<string, string>
  indexSummary?: IndexSummary | null
  readPaths?: ReadonlySet<string>
  addedPaths?: ReadonlySet<string>
  onSelect: (path: string, entry: RootEntry) => void
  onToggle: (path: string, expanded?: boolean) => void
  onRetry: (path: string) => void
  onReveal?: (path: string) => void
  onAdd?: (directory: string) => void
  edit?: EntryEdit | null
  editBusy?: boolean
  onEditChange?: (draft: string) => void
  onEditCommit?: (fromBlur: boolean) => void
  onEditCancel?: () => void
  onStartRename?: (path: string, entry: RootEntry) => void
  onStartCreate?: (directory: string) => void
  onRequestDelete?: (path: string, entry: RootEntry) => void
  /** 复制条目的绝对路径（由面板换算） */
  onCopyPath?: (path: string) => void
  /** 文件行就地纳入或排除索引 */
  onToggleFileIndex?: (path: string) => void
  /** 目录行就地纳入或排除索引 */
  onToggleDirectoryIndex?: (directory: string) => void
}) {
  const rows = visibleRows(tree)
  const container = useRef<HTMLUListElement>(null)
  const creating = (directory: string) => edit?.kind === 'create' && edit.directory === directory ? edit : null
  const draftRow = (depth: number, key: string) => {
    const pending = edit?.kind === 'create' ? edit : null
    if (!pending) return null
    return <li key={key} role="none" className="folder-entry-draft">
      <div role="none" style={{paddingLeft: depth * INDENT + 8}} className="flex min-h-8 items-center gap-1.5 pr-2">
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
        <EntryNameInput label="新文件夹名称" value={pending.draft} error={pending.error} busy={editBusy}
          onChange={value => onEditChange?.(value)} onCommit={() => onEditCommit?.(false)}
          onCancel={() => onEditCancel?.()} onBlur={() => onEditCommit?.(true)}/>
      </div>
    </li>
  }
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
    {creating('') && draftRow(0, 'draft-root')}
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
      const pendingOutput = isFile && Boolean(indexSummary?.scan.pending_outputs?.includes(path))
      const indexLabel = pendingOutput ? '未纳入索引' : status ? INDEX_LABEL[status] : undefined
      const read = isFile && readPaths?.has(path)
      const fresh = isFile && addedPaths?.has(path)
      const operations = entryActionsFor(entry.kind)
      const fileIndex = isFile && indexSummary && onToggleFileIndex ? fileIndexAction(path, indexSummary) : null
      const dirIndex = isDirectory && indexSummary && onToggleDirectoryIndex ? directoryIndexAction(path, indexSummary) : null
      // 只列出能完成的项：文件先预览；目录可新建文件夹；删除放最后，前面用分隔线隔开
      const menu: MenuEntry[] = [
        ...(isFile ? [menuItem('预览', Eye, () => onSelect(path, entry))] : []),
        ...(interactive && onAdd ? [menuItem(isFile ? '添加文件到所在目录' : '添加文件到此目录', Plus,
          () => onAdd(uploadTarget({path, kind: entry.kind})))] : []),
        ...(operations.createFolder && onStartCreate ? [menuItem('新建文件夹', FolderPlus, () => onStartCreate(path))] : []),
        ...(interactive && onReveal ? [menuItem(`在 ${fileManagerName()} 中显示`, Finder, () => onReveal(path))] : []),
        ...(fileIndex && onToggleFileIndex ? [menuItem(
          fileIndex.kind === 'exclude' ? '从索引排除' : '纳入索引',
          fileIndex.kind === 'exclude' ? Ban : Layers,
          () => onToggleFileIndex(path),
        )] : []),
        ...(dirIndex && onToggleDirectoryIndex ? [menuItem(
          dirIndex === 'exclude' ? '从索引排除此目录' : '恢复目录索引',
          dirIndex === 'exclude' ? Ban : Layers,
          () => onToggleDirectoryIndex(path),
        )] : []),
        ...(onCopyPath ? [menuItem('复制路径', Copy, () => onCopyPath(path))] : []),
        ...(operations.rename && onStartRename ? [menuItem('重命名', Pencil, () => onStartRename(path, entry))] : []),
        ...(operations.remove && onRequestDelete ? [{type: 'separator'} as const,
          menuItem('删除', Trash, () => onRequestDelete(path, entry), {destructive: true})] : []),
      ]
      const renaming = edit?.kind === 'rename' && edit.path === path ? edit : null
      if (renaming) return <Fragment key={path}><li role="none">
        <div role="none" style={{paddingLeft: row.depth * INDENT + (isFile && row.depth > 0 ? 16 : 8)}} className="flex min-h-8 items-center gap-1.5 pr-2">
          {isFile ? <FileTypeBadge extension={fileExtension(entry.name)}/> : createElement(Icon, {className: 'size-4 shrink-0 text-muted-foreground', 'aria-hidden': true})}
          <EntryNameInput label={`重命名 ${entry.name}`} value={renaming.draft} error={renaming.error} busy={editBusy} selectBase
            onChange={value => onEditChange?.(value)} onCommit={() => onEditCommit?.(false)}
            onCancel={() => onEditCancel?.()} onBlur={() => onEditCommit?.(true)}/>
        </div>
      </li></Fragment>
      return <Fragment key={path}><li role="none">
        <ContextMenuSurface items={menu}>
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
            <span className="folder-index-dot" data-index={pendingOutput ? 'pending_component' : status} aria-hidden/>
            <span className={cn(!pendingOutput && status === 'searchable' && 'sr-only')}>{indexLabel}</span>
          </span>}
        </button></ContextMenuSurface>
      </li>
      {isDirectory && row.expanded && creating(path) && draftRow(row.depth + 1, `draft-${path}`)}
      </Fragment>
    })}
  </ul>
}
