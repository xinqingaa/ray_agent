'use client'

import {useCallback, useEffect, useState, useRef} from 'react'
import {ChevronDown, ChevronRight, FileText, Loader2, RefreshCw} from 'lucide-react'
import {ScrollArea} from '@/components/ui/scroll-area'
import {projectApi} from '@/lib/api/project'
import type {ProjectListing, ProjectTreeEntry} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {toast} from 'sonner'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {FilePreview} from '@/components/preview/file-preview'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'

function EmptyNote({children}: {children: string}) {
  return <p className="px-4 py-8 text-center text-meta text-faint">{children}</p>
}

type TreeNode = {
  entry: ProjectTreeEntry
  children?: ProjectTreeEntry[]
  loading?: boolean
  expanded?: boolean
  loaded?: boolean
  error?: string
}

export function ProjectPane({sessionId, refreshSignal, projectLevel = false, downloadProjectId, overview = false}: {sessionId: string; refreshSignal?: number; projectLevel?: boolean; downloadProjectId?: string; overview?: boolean}) {
  const {visibility} = useDeveloperMode()
  const epoch = useRef(0)
  const [revision, setRevision] = useState(0)
  const [rootLoading, setRootLoading] = useState(true)
  const [rootError, setRootError] = useState<string | null>(null)
  useEffect(() => () => {epoch.current++}, [sessionId, projectLevel])
  const [root, setRoot] = useState<ProjectListing | null>(null)
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const openFile = useCallback((path: string) => {setSelectedPath(path)}, [])

  useEffect(() => {
    const current = ++epoch.current
    setRootLoading(true)
    setRootError(null)
    void projectApi.getTree(sessionId, '', projectLevel).then(async (listing) => {
      if (projectLevel && !visibility.projectPaths) {
        const groups = await Promise.all(listing.entries.map(async entry => {
          if (entry.type !== 'directory' || !['uploads', 'outputs'].includes(entry.path)) return {entries:[entry], truncated:false}
          const children = await projectApi.getTree(sessionId, entry.path, projectLevel)
          // 保留真实路径；只省去系统目录这一层，不推断材料或成果类别。
          return {entries:children.entries, truncated:children.truncated}
        }))
        listing = {...listing, entries:groups.flatMap(group => group.entries), truncated:listing.truncated || groups.some(group => group.truncated)}
      }
      if (current !== epoch.current) return
      setRoot(listing)
      const next: Record<string, TreeNode> = {}
      for (const entry of listing.entries) next[entry.path] = {entry, expanded: false, loaded: false}
      setNodes(next)
    }).catch((err) => {
      if (current === epoch.current) {setRoot(null); setRootError(err instanceof Error ? err.message : '读取目录失败')}
    }).finally(() => {if (current === epoch.current) setRootLoading(false)})
    const epochCounter = epoch
    return () => {epochCounter.current++}
  }, [sessionId, projectLevel, refreshSignal, revision, openFile, visibility.projectPaths])

  const toggleDir = async (path: string) => {
    const node = nodes[path]
    if (!node || node.entry.type !== 'directory') return
    if (node.expanded) {
      setNodes((prev) => ({...prev, [path]: {...node, expanded: false}}))
      return
    }
    setNodes((prev) => ({...prev, [path]: {...node, expanded: true, loading: !node.loaded, error: undefined}}))
    if (!node.loaded) {
      const currentEpoch = epoch.current
      let listing: ProjectListing
      try {listing = await projectApi.getTree(sessionId, path, projectLevel)} catch (err) {
        if (currentEpoch === epoch.current) setNodes((prev) => ({...prev, [path]: {...prev[path], loading: false, loaded: false, error: err instanceof Error ? err.message : '读取目录失败'}}))
        return
      }
      if (currentEpoch !== epoch.current) return
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
          <span className="min-w-0 truncate text-sm" title={visibility.projectPaths ? entry.path : entry.name}>{entry.name}</span>
          {entry.is_symlink && <span className="text-[10px] text-faint">链接</span>}
        </button>
        {isDir && expanded && node?.loading && (
          <p className="py-1 text-xs text-muted-foreground" style={{paddingLeft: `${depth * 12 + 28}px`}}>
            <Loader2 className="mr-1 inline size-3 animate-spin"/>
            正在读取
          </p>
        )}
        {isDir && expanded && node?.error && <p role="alert" className="px-3 py-1 text-meta text-state-failed">{node.error}</p>}
        {isDir && expanded && node?.children?.map((child) => renderEntry(child, depth + 1))}
      </div>
    )
  }

  if (rootError) return <div><p role="alert" className="px-4 py-4 text-meta text-state-failed">{rootError}</p><Button variant="ghost" onClick={() => setRevision((n) => n + 1)}>重试</Button></div>
  if (!root) return <EmptyNote>正在读取项目文件</EmptyNote>

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", overview && "max-h-96")}>
      {!overview && <div className="flex items-center border-b px-3 py-2">
        <span className="flex-1 text-meta text-muted-foreground">文件列表</span>

        <Button type="button" variant="ghost" size="icon-xs" aria-label="刷新项目文件" disabled={rootLoading} onClick={() => setRevision((n) => n + 1)}>
          {rootLoading ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}
        </Button>
      </div>}
      <ScrollArea className={cn("min-h-0 shrink-0", selectedPath && !overview ? "max-h-40 border-b" : overview ? "max-h-48" : "flex-1")}>
        <div className="py-1">
          {root.entries.length === 0 && <p className="px-3 py-4 text-meta text-faint">还没有可查看的文件。</p>}
          {(overview ? root.entries.slice(0, 4) : root.entries).map((entry) => renderEntry(entry, 0))}
          {root.truncated && (
            <p className="px-3 py-2 text-xs text-muted-foreground">条目过多，只显示前 {root.limit} 项。</p>
          )}
        </div>
      </ScrollArea>
      {overview ? <Dialog open={!!selectedPath} onOpenChange={open=>{if(!open)setSelectedPath(null)}}><DialogContent className="flex h-[90dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]"><DialogTitle className="sr-only">{selectedPath?.split('/').pop()}</DialogTitle><DialogDescription className="sr-only">项目文件预览</DialogDescription>{selectedPath && <div className="min-h-0 flex-1"><FilePreview key={`${sessionId}:${selectedPath}:${refreshSignal ?? 0}:${revision}`} source={{kind:'project',id:sessionId,path:selectedPath,filename:selectedPath.split('/').pop() || selectedPath,projectLevel}}
          canExpand={!overview} onBack={() => setSelectedPath(null)} onDownload={downloadProjectId ? () => {void projectApi.download(downloadProjectId,selectedPath).then(value => {
            if(value.warning)toast.warning(value.warning)
            const link=document.createElement('a');link.href=value.url;link.download=value.filename;document.body.appendChild(link);link.click();link.remove()
          }).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))} : undefined}/></div>}</DialogContent></Dialog> : <div className={cn("min-h-0", selectedPath && "flex min-h-64 flex-1 flex-col")}>
        {selectedPath && <details className="px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">文件位置</summary><code className="mt-1 block break-all">{selectedPath}</code></details>}
        {selectedPath ? <div className="min-h-0 flex-1"><FilePreview key={`${sessionId}:${selectedPath}:${refreshSignal ?? 0}:${revision}`} source={{kind:'project',id:sessionId,path:selectedPath,filename:selectedPath.split('/').pop() || selectedPath,projectLevel}}
          canExpand={!overview} onBack={() => setSelectedPath(null)} onDownload={downloadProjectId ? () => {void projectApi.download(downloadProjectId,selectedPath).then(value => {
            if(value.warning)toast.warning(value.warning)
            const link=document.createElement('a');link.href=value.url;link.download=value.filename;document.body.appendChild(link);link.click();link.remove()
          }).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))} : undefined}/></div>
          : !overview && <p className="p-4 text-xs text-muted-foreground">点击文件查看内容与下载。</p>}
      </div>}

    </div>
  )
}
