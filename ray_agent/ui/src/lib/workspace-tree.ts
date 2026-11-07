import type {RootEntry, RootListing} from '@/lib/api/types'

/**
 * 文件夹面板的树数据：按目录懒加载，每个目录一份列表与状态。
 * 符号链接与特殊文件只作为条目显示，不展开；展开状态与目录内容分开保存，刷新某个目录不丢失其他目录的展开。
 */
export type DirectoryState =
  | {status: 'loading'; entries: RootEntry[]; truncated: false}
  | {status: 'ready'; entries: RootEntry[]; truncated: boolean}
  | {status: 'error'; entries: RootEntry[]; truncated: boolean; message: string}

export type TreeState = {
  /** 键为根内相对路径，根目录为空串 */
  directories: Record<string, DirectoryState>
  expanded: string[]
}

export type TreeRow =
  | {kind: 'entry'; path: string; entry: RootEntry; depth: number; expandable: boolean; expanded: boolean}
  | {kind: 'status'; path: string; depth: number; state: 'loading' | 'error' | 'empty' | 'truncated'; message?: string}

export const EMPTY_TREE: TreeState = {directories: {}, expanded: []}

export const joinPath = (directory: string, name: string) => directory ? `${directory}/${name}` : name
export const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

export function sortEntries(entries: RootEntry[]): RootEntry[] {
  const folder = (entry: RootEntry) => entry.kind === 'directory' ? 0 : 1
  return [...entries].sort((a, b) => folder(a) - folder(b) || a.name.localeCompare(b.name, 'zh', {numeric: true, sensitivity: 'base'}))
}

export function beginLoad(tree: TreeState, path: string): TreeState {
  const current = tree.directories[path]
  // 已有内容时刷新不清空列表，避免面板闪动
  if (current && current.entries.length) return tree
  return {...tree, directories: {...tree.directories, [path]: {status: 'loading', entries: [], truncated: false}}}
}

export function applyListing(tree: TreeState, path: string, listing: RootListing): TreeState {
  return {...tree, directories: {...tree.directories, [path]: {status: 'ready', entries: sortEntries(listing.entries), truncated: listing.truncated}}}
}

export function applyError(tree: TreeState, path: string, message: string): TreeState {
  const current = tree.directories[path]
  return {...tree, directories: {...tree.directories, [path]: {status: 'error', entries: current?.entries ?? [], truncated: current?.truncated ?? false, message}}}
}

export function setExpanded(tree: TreeState, path: string, expanded: boolean): TreeState {
  const has = tree.expanded.includes(path)
  if (expanded === has) return tree
  return {...tree, expanded: expanded ? [...tree.expanded, path] : tree.expanded.filter(item => item !== path && !item.startsWith(`${path}/`))}
}

/** 一个目录重新列出后，已不存在的子目录连同其缓存与展开状态一起丢弃。 */
export function pruneMissing(tree: TreeState, path: string): TreeState {
  const dir = tree.directories[path]
  if (!dir || dir.status !== 'ready') return tree
  const present = new Set(dir.entries.filter(entry => entry.kind === 'directory').map(entry => joinPath(path, entry.name)))
  const gone = (candidate: string) => {
    if (candidate === path || !(path ? candidate.startsWith(`${path}/`) : true)) return false
    const rest = path ? candidate.slice(path.length + 1) : candidate
    return !present.has(joinPath(path, rest.split('/')[0]))
  }
  const directories = Object.fromEntries(Object.entries(tree.directories).filter(([key]) => !gone(key)))
  return {directories, expanded: tree.expanded.filter(key => !gone(key))}
}

/** 需要（重新）读取的目录：根与所有展开且尚未读到的目录。 */
export function pendingDirectories(tree: TreeState): string[] {
  return ['', ...tree.expanded].filter((path, index, all) => all.indexOf(path) === index && !tree.directories[path])
}

export function visibleRows(tree: TreeState): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (path: string, depth: number) => {
    const dir = tree.directories[path]
    if (!dir) {rows.push({kind: 'status', path, depth, state: 'loading'}); return}
    for (const entry of dir.entries) {
      const key = joinPath(path, entry.name)
      const expandable = entry.kind === 'directory'
      const expanded = expandable && tree.expanded.includes(key)
      rows.push({kind: 'entry', path: key, entry, depth, expandable, expanded})
      if (expanded) walk(key, depth + 1)
    }
    if (dir.status === 'loading') rows.push({kind: 'status', path, depth, state: 'loading'})
    else if (dir.status === 'error') rows.push({kind: 'status', path, depth, state: 'error', message: dir.message})
    else if (!dir.entries.length) rows.push({kind: 'status', path, depth, state: 'empty'})
    else if (dir.truncated) rows.push({kind: 'status', path, depth, state: 'truncated'})
  }
  walk('', 0)
  return rows
}

/** 添加文件的目标目录：所选目录；所选是文件时用其所在目录；没有选择为根。 */
export function uploadTarget(selected: {path: string; kind: RootEntry['kind']} | null): string {
  if (!selected) return ''
  return selected.kind === 'directory' ? selected.path : parentPath(selected.path)
}
