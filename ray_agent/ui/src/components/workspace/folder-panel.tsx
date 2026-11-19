import {useEffect, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref} from 'react'
import {createPortal} from 'react-dom'
import {Download, Finder, FolderSearch, FolderX, MoreHorizontal, Plus, RefreshCw, ScrollText, X} from '@/components/ui/icons'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {ScrollArea} from '@/components/ui/scroll-area'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {FilePreview} from '@/components/preview/file-preview'
import {FileRow} from '@/components/preview/file-row'
import {useFolderTree} from '@/hooks/use-folder-tree'
import {ApiError} from '@/lib/api/fetch'
import {documentsApi, type IndexSummary} from '@/lib/api/documents'
import {fileManagerName, isDesktop, revealInFileManager} from '@/lib/platform'
import {historyApi, rootApi} from '@/lib/api/workspace'
import {downloadPreviewSource, type PreviewSource} from '@/lib/api/preview'
import type {ModifiedRun, RootEntry, WorkspaceItem} from '@/lib/api/types'
import type {FileView} from '@/lib/session-view'
import {cn} from '@/lib/utils'
import {useSessionTitleLookup} from '@/hooks/use-session-title'
import {leaseConflictText, leaseFromDetails, touchesFile} from '@/lib/workspace-changes'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {uploadTarget} from '@/lib/workspace-tree'
import {FolderTree} from './folder-tree'
import {RecentChanges} from './recent-changes'

function remainingIndexStatus(summary: IndexSummary) {
  const parts: string[] = []
  if (summary.parsing || summary.pending) parts.push(`处理中 ${(summary.parsing || 0) + (summary.pending || 0)}`)
  if (summary.pending_component) parts.push(`待 OCR ${summary.pending_component}`)
  if (summary.failed) parts.push(`失败 ${summary.failed}`)
  return parts.join(' · ')
}

export type FolderPanelTab = 'folder' | 'delivered' | 'recent'

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function describeUpload(names: Array<{asked: string; saved: string}>, failed: Array<{name: string; message: string}>) {
  for (const {asked, saved} of names) if (asked !== saved) toast.message(`「${asked}」已存在，已另存为「${saved}」`)
  const done = names.length
  if (done > 1 || (done === 1 && names[0].asked === names[0].saved)) toast.success(done === 1 ? `已添加「${names[0].saved}」` : `已添加 ${done} 个文件`)
  for (const item of failed) toast.error(`「${item.name}」添加失败：${item.message}`)
}

/**
 * 工作区的右侧面板：文件夹文件树与预览，会话里再多一个“本次成果”（交付时保存的版本）。
 *
 * 文件夹随外部变更（工作区页的变更订阅）按受影响的目录刷新；正在预览的文件被改动时提示重新载入。
 * 有运行修改过文件夹时多一个“最近修改”页，列出这些运行并可进入撤销。
 */
export type FolderPanelRef = {addFiles: (files: File[]) => void; closePreview: () => void; target: string}

export function FolderPanel({workspace, deliveries, deliveryLabel = '本次交付', deliveryEmpty = '这个对话还没有交付文件。', onClose, embedded = false, onOpenWorkingStyle, className, selectedTab, toolbarTarget, readPaths, visible = true, ref}: {
  workspace: WorkspaceItem
  /** 会话里的交付文件；工作区首页没有会话，传空则不显示“本次成果” */
  deliveries?: FileView[]
  deliveryLabel?: string
  deliveryEmpty?: string
  onClose?: () => void
  /** 嵌在带切换栏的面板里时用更矮的标题行 */
  embedded?: boolean
  /** 工作区首页：打开工作方式设置 */
  onOpenWorkingStyle?: () => void
  className?: string
  selectedTab?: FolderPanelTab | 'inspect'
  toolbarTarget?: HTMLElement | null
  readPaths?: ReadonlySet<string>
  visible?: boolean
  ref?: Ref<FolderPanelRef>
}) {
  const folder = workspace.folder
  const condition = describeWorkspace(workspace)
  const [tab, setTab] = useState<FolderPanelTab>('folder')
  const live = useWorkspaceLive()
  const titleOf = useSessionTitleLookup()
  const [opened, setOpened] = useState<PreviewSource | null>(null)
  const [openedOn, setOpenedOn] = useState<FolderPanelTab | 'inspect'>('folder')
  const [stale, setStale] = useState(false)
  const [revision, setRevision] = useState(0)
  const [runs, setRuns] = useState<ModifiedRun[]>([])
  const [selected, setSelected] = useState<{path: string; kind: RootEntry['kind']} | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [indexSummary, setIndexSummary] = useState<IndexSummary | null>(null)
  const [indexStates, setIndexStates] = useState<ReadonlyMap<string, string>>(new Map())
  const [addedPaths, setAddedPaths] = useState<ReadonlySet<string>>(new Set())
  const picker = useRef<HTMLInputElement>(null)
  const {tree, toggle, reload, loadDirectory} = useFolderTree(folder?.root_id ?? null, condition.folderAvailable, live.change)
  const target = uploadTarget(selected)
  const showDelivered = deliveries != null
  const showRecent = condition.writable && runs.length > 0
  const standaloneTab = tab === 'delivered' && showDelivered ? 'delivered' : tab === 'recent' && showRecent ? 'recent' : 'folder'
  const activeTab = selectedTab ?? standaloneTab

  const visiblePreview = openedOn === activeTab ? opened : null

  // 最近修改过文件夹的运行：随变化批次与租约的释放重读（运行结束没有单独的推送，租约释放是它的信号）
  const leaseId = live.lease?.id ?? null
  useEffect(() => {
    if (!condition.writable) {setRuns([]); return}
    let cancelled = false
    historyApi.modifiedRuns(workspace.id)
      .then(next => {if (!cancelled) setRuns(next)})
      .catch(() => {})
    return () => {cancelled = true}
  }, [workspace.id, condition.writable, live.change.signal, leaseId])

  // 文档索引汇总：随外部变更批次刷新
  useEffect(() => {
    if (!condition.folderAvailable) {setIndexSummary(null); setIndexStates(new Map()); return}
    if (!visible || activeTab !== 'folder') return
    let cancelled = false
    documentsApi.summary(workspace.id)
      .then(next => {if (!cancelled) setIndexSummary(next)})
      .catch(() => {if (!cancelled) setIndexSummary(null)})
    documentsApi.list(workspace.id)
      .then(next => {if (!cancelled) setIndexStates(new Map(next.map(item => [item.relative_path, item.status])))})
      .catch(() => {if (!cancelled) setIndexStates(new Map())})
    return () => {cancelled = true}
  }, [workspace.id, condition.folderAvailable, visible, activeTab, live.change.signal])

  // 正在预览的文件被报告变化：提示重新载入，不自动替换用户正在看的内容
  useEffect(() => {
    if (opened?.kind === 'root' && touchesFile(live.change.batch, opened.path)) setStale(true)
  }, [live.change]) // eslint-disable-line react-hooks/exhaustive-deps -- 只由新批次触发
  const open = (source: PreviewSource | null) => {
    setStale(false)
    setOpened(source)
    if (source) setOpenedOn(activeTab)
  }

  const upload = async (files: File[]) => {
    if (!folder || !condition.writable || uploading || !files.length) return
    setUploading(true)
    const saved: Array<{asked: string; saved: string}> = []
    const failed: Array<{name: string; message: string}> = []
    for (const file of files) {
      try {
        const entry = await rootApi.upload(folder.root_id, file, target)
        saved.push({asked: file.name, saved: entry.name})
      } catch (error) {
        const lease = error instanceof ApiError && error.code === 'conflict' ? leaseFromDetails(error.details) : null
        if (lease) {
          // 文件夹被占用：后面的文件同样会被拒绝，不再逐个尝试
          toast.error(leaseConflictText(lease, titleOf(lease.owner_session_id)))
          void live.refreshLease()
          break
        }
        failed.push({name: file.name, message: error instanceof Error ? error.message : '请求失败'})
      }
    }
    setUploading(false)
    describeUpload(saved, failed)
    if (saved.length) {
      setAddedPaths(current => new Set([...current, ...saved.map(item => target ? `${target}/${item.saved}` : item.saved)]))
      if (target) toggle(target, true)
      void loadDirectory(target)
    }
  }

  useImperativeHandle(ref, () => ({
    target,
    closePreview: () => open(null),
    addFiles: files => {open(null); void upload(files)},
  }))

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (condition.writable && activeTab === 'folder' && !visiblePreview) void upload(Array.from(event.dataTransfer.files))
  }

  const openRoot = (path: string, entry: RootEntry) => {
    if (!folder) return
    open({kind: 'root', rootId: folder.root_id, path, filename: entry.name, size: entry.size})
  }

  // 在系统文件管理器中显示：预览中的文件、否则树里选中的条目、否则文件夹本身；只有桌面宿主能做到，浏览器开发模式不提供
  const revealPath = visiblePreview ? (visiblePreview.kind === 'root' ? visiblePreview.path : null) : activeTab === 'folder' ? selected?.path ?? '' : null
  const revealable = isDesktop() && !!folder && condition.folderAvailable && revealPath != null
  const reveal = async () => {
    if (!folder || revealPath == null) return
    try {await revealInFileManager(folder.root_id, revealPath)}
    catch (error) {toast.error(error instanceof Error ? error.message : '无法显示位置')}
  }

  const revealAction = revealable && <IconAction label={`在 ${fileManagerName()} 中显示${revealPath ? '' : '文件夹'}`}
    onClick={() => void reveal()} className="text-muted-foreground"><Finder className="size-4" aria-hidden/></IconAction>
  const folderMenu = condition.folderAvailable && activeTab === 'folder' && !visiblePreview && <DropdownMenu>
    <DropdownMenuTrigger asChild><IconAction label="文件夹操作"><MoreHorizontal/></IconAction></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {condition.writable && <DropdownMenuItem disabled={uploading} onSelect={() => picker.current?.click()}>
        <Plus/>{uploading ? '正在添加' : '添加文件'}{target && <span className="ml-auto max-w-24 truncate text-xs text-faint" title={target}>{target}</span>}
      </DropdownMenuItem>}
      <DropdownMenuItem onSelect={reload}><RefreshCw/>刷新目录</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  const header = <header className={cn('flex shrink-0 items-center gap-1 px-2.5', embedded ? 'min-h-9' : 'min-h-12 border-b')}>
    <div className="min-w-0 flex-1">
      <h2 className={cn('truncate font-medium', embedded ? 'text-xs text-muted-foreground' : 'text-sm')} dir="auto" title={folder?.path}>{folder ? folderName(folder.path) : '文件夹'}</h2>
    </div>
    {onOpenWorkingStyle && <IconAction label="工作方式" onClick={onOpenWorkingStyle} className="text-muted-foreground"><ScrollText className="size-4" aria-hidden/></IconAction>}
    {revealAction}
    {condition.folderAvailable && activeTab === 'folder' && !visiblePreview && <IconAction label="刷新" onClick={reload} className="text-muted-foreground"><RefreshCw className="size-4" aria-hidden/></IconAction>}
    {onClose && <IconAction label="收起文件夹面板" onClick={onClose} className="text-muted-foreground"><X className="size-4" aria-hidden/></IconAction>}
  </header>

  let body: ReactNode
  if (visiblePreview) {
    body = <div className="flex min-h-0 flex-1 flex-col">
      {stale && <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-state-waiting-soft px-3 py-2 text-xs">
        <span className="min-w-0 flex-1">这个文件刚被修改或删除。</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => {setStale(false); setRevision(value => value + 1)}}>重新载入</Button>
      </div>}
      <div className="min-h-0 flex-1"><FilePreview key={revision} source={visiblePreview} onBack={() => open(null)}/></div>
    </div>
  } else if (activeTab === 'delivered') {
    body = <ScrollArea className="min-h-0 flex-1"><div className="px-3 pb-3">
      {deliveries?.length ? <h2 className="px-1.5 py-1.5 text-xs font-medium text-faint">{deliveryLabel}</h2>
        : <p className="px-2 py-8 text-center text-meta text-muted-foreground">{deliveryEmpty}</p>}
      {deliveries?.map(file => {
        const rootId = folder?.root_id
        const inFolder = rootId && file.rootId === rootId && file.relativePath ? file.relativePath : null
        return <FileRow key={file.id} file={file} versionLabel="交付版本"
          onOpen={() => open({kind: 'attachment', id: file.id, filename: file.filename, size: file.size})}
          actions={<DropdownMenu>
            <DropdownMenuTrigger asChild><IconAction label={`${file.filename} 的操作`}><MoreHorizontal/></IconAction></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rootId && inFolder && <DropdownMenuItem title={inFolder}
                onSelect={() => open({kind: 'root', rootId, path: inFolder, filename: file.filename, size: null})}><FolderSearch/>查看文件夹中的当前版本</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => void downloadPreviewSource({kind: 'attachment', id: file.id, filename: file.filename}).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))}><Download/>下载交付版本</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}/>
      })}
    </div></ScrollArea>
  } else if (activeTab === 'recent') {
    body = <ScrollArea className="min-h-0 flex-1"><div className="space-y-2 p-2">
      <h2 className="px-1.5 py-1 text-xs font-medium text-faint">最近修改</h2>
      {runs.length > 0 ? <RecentChanges workspaceId={workspace.id} runs={runs}/>
        : <p className="px-2 py-6 text-center text-meta text-muted-foreground">暂无可查看的修改记录。</p>}
    </div></ScrollArea>
  } else if (activeTab === 'inspect') {
    body = <p className="px-4 py-8 text-center text-meta text-faint">选择文件夹或成果中的文件进行预览。</p>
  } else if (!folder || !condition.folderAvailable) {
    body = <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderX className="size-6 text-muted-foreground" aria-hidden/>
      <p className="text-sm font-medium">文件夹暂时不可用</p>
      <p className="text-meta text-muted-foreground">{folder ? <span className="break-all">{folder.path}</span> : '这个工作区没有绑定文件夹。'}</p>
    </div>
  } else {
    body = <>
      <ScrollArea className={cn('min-h-0 flex-1', embedded && 'px-2 pt-0.5')}>
        <FolderTree tree={tree} selectedPath={selected?.path ?? null} indexStates={indexStates} readPaths={readPaths} addedPaths={addedPaths}
          onToggle={toggle} onRetry={path => void loadDirectory(path)}
          onSelect={(path, entry) => {
            setSelected({path, kind: entry.kind})
            if (entry.kind === 'file') openRoot(path, entry)
          }}/>
      </ScrollArea>
      {!!indexSummary?.total && <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/65 px-3.5 py-2 text-xs text-faint" title="文档全文索引状态">
        <span className="tabular-nums">可检索 {indexSummary.searchable}/{indexSummary.total}</span>
        <progress aria-label="可检索文档" className="folder-index-progress" max={indexSummary.total} value={indexSummary.searchable}/>
        {remainingIndexStatus(indexSummary) && <span>{remainingIndexStatus(indexSummary)}</span>}
      </div>}
      {!embedded && <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
        {condition.writable ? <>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={target || undefined}>添加到 {target ? <span className="font-mono">{target}</span> : '文件夹根目录'}</p>
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => picker.current?.click()}>
            <Plus aria-hidden/>{uploading ? '正在添加' : '添加文件'}
          </Button>
        </> : <p className="text-xs text-muted-foreground">{condition.archived ? '工作区已归档，不能再添加文件。' : '工作区不可写，不能添加文件。'}</p>}
      </footer>}
    </>
  }

  return <aside aria-label="文件夹面板"
    onDragOver={event => {if (condition.writable && activeTab === 'folder' && !visiblePreview && event.dataTransfer.types.includes('Files')) {event.preventDefault(); setDragging(true)}}}
    onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)}}
    onDrop={onDrop}
    className={cn('relative flex min-h-0 flex-col bg-background', dragging && 'ring-2 ring-inset ring-signal', className)}>
    {!embedded && header}
    {embedded && visible && toolbarTarget && createPortal(<>{folderMenu}{revealAction}</>, toolbarTarget)}
    <input ref={picker} type="file" multiple hidden onChange={event => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      void upload(files)
    }}/>
    {!selectedTab && (showDelivered || showRecent) && !visiblePreview && <div className="shrink-0 border-b px-3 py-2">
      <SegmentedControl<FolderPanelTab> value={standaloneTab} onValueChange={setTab} label="文件夹面板视图" className="w-full"
        options={[
          {value: 'folder', label: '文件夹'},
          ...(deliveries ? [{value: 'delivered' as const, label: deliveries.length ? `本次成果 ${deliveries.length}` : '本次成果'}] : []),
          ...(showRecent ? [{value: 'recent' as const, label: '最近修改'}] : []),
        ]}/>
    </div>}
    {body}
  </aside>
}
