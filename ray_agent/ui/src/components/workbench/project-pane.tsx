'use client'

import {useCallback, useEffect, useState} from 'react'
import {ChevronDown, ChevronRight, FileText, Loader2} from 'lucide-react'
import {ScrollArea} from '@/components/ui/scroll-area'
import {projectApi} from '@/lib/api/project'
import type {ProjectFile, ProjectListing, ProjectTreeEntry} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {toast} from 'sonner'

function EmptyNote({children}: {children: string}) {
  return <p className="px-4 py-8 text-center text-meta text-faint">{children}</p>
}

type TreeNode = {
  entry: ProjectTreeEntry
  children?: ProjectTreeEntry[]
  loading?: boolean
  expanded?: boolean
  loaded?: boolean
}

export function ProjectPane({sessionId}: {sessionId: string}) {
  const [root, setRoot] = useState<ProjectListing | null>(null)
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [file, setFile] = useState<ProjectFile | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const loadDir = useCallback(async (relative: string) => {
    try {
      return await projectApi.getTree(sessionId, relative)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取目录失败')
      return null
    }
  }, [sessionId])

  useEffect(() => {
    void (async () => {
      const listing = await loadDir('')
      if (!listing) return
      setRoot(listing)
      const next: Record<string, TreeNode> = {}
      for (const entry of listing.entries) {
        if (entry.type === 'directory') {
          next[entry.path] = {entry, expanded: false, loaded: false}
        } else {
          next[entry.path] = {entry}
        }
      }
      setNodes(next)
    })()
  }, [loadDir])

  const toggleDir = async (path: string) => {
    const node = nodes[path]
    if (!node || node.entry.type !== 'directory') return
    if (node.expanded) {
      setNodes((prev) => ({...prev, [path]: {...node, expanded: false}}))
      return
    }
    setNodes((prev) => ({...prev, [path]: {...node, expanded: true, loading: !node.loaded}}))
    if (!node.loaded) {
      const listing = await loadDir(path)
      setNodes((prev) => {
        const current = prev[path]
        if (!current) return prev
        const children = listing?.entries ?? []
        const childNodes = {...prev}
        for (const entry of children) {
          if (!childNodes[entry.path]) {
            childNodes[entry.path] = entry.type === 'directory'
              ? {entry, expanded: false, loaded: false}
              : {entry}
          }
        }
        childNodes[path] = {...current, loading: false, loaded: true, children}
        return childNodes
      })
    }
  }

  const openFile = async (path: string) => {
    setSelectedPath(path)
    setFileLoading(true)
    setFile(null)
    try {
      const result = await projectApi.getFile(sessionId, path)
      setFile(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取文件失败')
    } finally {
      setFileLoading(false)
    }
  }

  const renderEntry = (entry: ProjectTreeEntry, depth: number) => {
    const node = nodes[entry.path]
    const isDir = entry.type === 'directory'
    const expanded = node?.expanded
    return (
      <div key={entry.path}>
        <button
          type="button"
          style={{paddingLeft: `${depth * 12 + 8}px`}}
          onClick={() => {
            if (isDir) void toggleDir(entry.path)
            else void openFile(entry.path)
          }}
          className={cn(
            'flex w-full items-center gap-1 py-1 pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            selectedPath === entry.path && 'bg-muted',
          )}
        >
          {isDir ? (
            expanded ? <ChevronDown className="size-3.5 shrink-0"/> : <ChevronRight className="size-3.5 shrink-0"/>
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground"/>
          )}
          <span className="min-w-0 truncate font-mono text-xs">{entry.name}</span>
          {entry.is_symlink && <span className="text-[10px] text-faint">链接</span>}
        </button>
        {isDir && expanded && node?.loading && (
          <p className="py-1 text-xs text-muted-foreground" style={{paddingLeft: `${depth * 12 + 28}px`}}>
            <Loader2 className="mr-1 inline size-3 animate-spin"/>
            正在读取
          </p>
        )}
        {isDir && expanded && node?.children?.map((child) => renderEntry(child, depth + 1))}
      </div>
    )
  }

  if (!root) {
    return <EmptyNote>正在加载项目文件树</EmptyNote>
  }

  if (root.entries.length === 0) {
    return <EmptyNote>项目目录为空，或当前层没有可列出的文件。</EmptyNote>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 max-h-[45%] shrink-0 border-b">
        <div className="py-1">
          {root.entries.map((entry) => renderEntry(entry, 0))}
          {root.truncated && (
            <p className="px-3 py-2 text-xs text-muted-foreground">条目过多，只显示前 {root.limit} 项。</p>
          )}
        </div>
      </ScrollArea>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {!selectedPath && <p className="text-meta text-faint">选中文件以预览内容。</p>}
          {selectedPath && fileLoading && (
            <p className="text-meta text-muted-foreground"><Loader2 className="mr-1 inline size-4 animate-spin"/>正在读取</p>
          )}
          {file && file.kind === 'text' && file.content != null && (
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
              {file.content.length > 20000 ? `${file.content.slice(0, 20000)}…` : file.content}
            </pre>
          )}
          {file && file.kind === 'binary' && (
            <p className="text-meta text-faint">这是二进制文件（{file.name}，{file.size} 字节），无法在界面中预览。</p>
          )}
          {file && file.kind === 'too_large' && (
            <p className="text-meta text-faint">
              文件过大（{file.name}，{file.size} 字节），超过 {file.max_bytes} 字节上限，只显示元数据。
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
