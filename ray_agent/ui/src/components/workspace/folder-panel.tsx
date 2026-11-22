import {useEffect, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref} from 'react'
import {createPortal} from 'react-dom'
import {Copy, Download, Finder, FolderPlus, FolderSearch, FolderX, MoreHorizontal, Plus, ScrollText, X} from '@/components/ui/icons'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {MenuEntryItems} from '@/components/ui/menu-entries'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {copyText} from '@/lib/clipboard'
import {ScrollArea} from '@/components/ui/scroll-area'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {FilePreview} from '@/components/preview/file-preview'
import {FileRow} from '@/components/preview/file-row'
import {useFolderTree} from '@/hooks/use-folder-tree'
import {ApiError} from '@/lib/api/fetch'
import {documentsApi, type IndexSummary} from '@/lib/api/documents'
import {
  directoryIndexAction, excludeDirectory, excludeFile, fileIndexAction, includeDirectory, includeFile, normalizePolicy,
} from '@/lib/document-index-policy'
import {fileManagerName, isDesktop, revealInFileManager} from '@/lib/platform'
import {historyApi, rootApi} from '@/lib/api/workspace'
import {downloadPreviewSource, type PreviewSource, type RootSource} from '@/lib/api/preview'
import type {ModifiedRun, RootEntry, WorkspaceItem} from '@/lib/api/types'
import type {FileView} from '@/lib/session-view'
import {cn} from '@/lib/utils'
import {useSessionTitleLookup} from '@/hooks/use-session-title'
import {leaseConflictText, leaseFromDetails, touchesFile} from '@/lib/workspace-changes'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {Link} from '@/lib/navigation'
import {workspaceKnowledgeHref} from '@/lib/workspace-route'
import {joinPath, parentPath, uploadTarget} from '@/lib/workspace-tree'
import {checkNewName, checkRenameName, createEdit, renameEdit, type EntryEdit} from '@/lib/workspace-entries'
import {useEntryOperations} from '@/hooks/use-entry-operations'
import {FolderTree} from './folder-tree'
import {FolderToolbarActions} from './folder-toolbar-actions'
import {DeleteEntryDialog} from './delete-entry-dialog'
import {RecentChanges} from './recent-changes'

function remainingIndexStatus(summary: IndexSummary) {
  const parts: string[] = []
  if (summary.scope_review_required) parts.push('待确认索引范围')
  else if (summary.policy?.paused) parts.push('索引已暂停')
  else if (summary.parsing || summary.pending) parts.push(`处理中 ${(summary.parsing || 0) + (summary.pending || 0)}`)
  if (summary.scan?.pending_outputs?.length) parts.push(`待纳入 ${summary.scan.pending_outputs.length}`)
  if (summary.pending_component) parts.push(`待 OCR ${summary.pending_component}`)
  if (summary.failed) parts.push(`失败 ${summary.failed}`)
  return parts.join(' · ')
}

export type FolderPanelTab = 'folder' | 'delivered' | 'recent'

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** 根目录下某个相对路径的绝对路径，沿用根目录的分隔符（Windows 反斜杠）。 */
function absolutePath(root: string, relative: string) {
  if (!relative) return root
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative.split('/').join(separator)}`
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
export type FolderPanelRef = {addFiles: (files: File[], directory?: string) => void; closePreview: () => void; target: string}

export function FolderPanel({workspace, deliveries, onOpenDelivery, deliveryStatus, deliveryLabel = '本次交付', deliveryEmpty = '这个对话还没有交付文件。', onClose, embedded = false, onOpenWorkingStyle, className, selectedTab, toolbarTarget, readPaths, initialPreview, onBackToKnowledge, visible = true, ref}: {
  workspace: WorkspaceItem
  /** 会话里的交付文件；工作区首页没有会话，传空则不显示“本次成果” */
  deliveries?: FileView[]
  deliveryLabel?: string
  deliveryEmpty?: string
  deliveryStatus?: {loading: boolean; error?: string | null; retry: () => void}
  onOpenDelivery?: (file: FileView) => void
  onClose?: () => void
  /** 嵌在带切换栏的面板里时用更矮的标题行 */
  embedded?: boolean
  /** 工作区首页：打开工作方式设置 */
  onOpenWorkingStyle?: () => void
  className?: string
  selectedTab?: FolderPanelTab | 'inspect'
  toolbarTarget?: HTMLElement | null
  readPaths?: ReadonlySet<string>
  initialPreview?: RootSource
  onBackToKnowledge?: () => void
  visible?: boolean
  ref?: Ref<FolderPanelRef>
}) {
  const folder = workspace.folder
  const condition = describeWorkspace(workspace)
  const [tab, setTab] = useState<FolderPanelTab>('folder')
  const live = useWorkspaceLive()
  const titleOf = useSessionTitleLookup()
  const [opened, setOpened] = useState<PreviewSource | null>(initialPreview?.rootId === folder?.root_id ? initialPreview ?? null : null)
  const [openedOn, setOpenedOn] = useState<FolderPanelTab | 'inspect'>('folder')
  const [stale, setStale] = useState(false)
  const [revision, setRevision] = useState(0)
  const [runs, setRuns] = useState<ModifiedRun[]>([])
  const [selected, setSelected] = useState<{path: string; kind: RootEntry['kind']} | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [indexSummary, setIndexSummary] = useState<IndexSummary | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexAttempt, setIndexAttempt] = useState(0)
  const [indexStates, setIndexStates] = useState<ReadonlyMap<string, string>>(new Map())
  const [addedPaths, setAddedPaths] = useState<ReadonlySet<string>>(new Set())
  const picker = useRef<HTMLInputElement>(null)
  const pickerDestination = useRef<{rootId: string; directory: string} | null>(null)
  const {tree, toggle, loadDirectory} = useFolderTree(folder?.root_id ?? null, condition.folderAvailable, live.change)
  const target = uploadTarget(selected)
  const ops = useEntryOperations(folder?.root_id ?? null, loadDirectory)
  // 就地编辑：编辑状态同时镜像到 ref，失焦与回车的提交读取最新草稿，并防止同一次编辑重复提交
  const [edit, setEdit] = useState<EntryEdit | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const editRef = useRef<EntryEdit | null>(null)
  const busyRef = useRef(false)
  const [removing, setRemoving] = useState<{path: string; entry: RootEntry} | null>(null)
  const showDelivered = deliveries != null
  const showRecent = condition.writable && runs.length > 0
  const standaloneTab = tab === 'delivered' && showDelivered ? 'delivered' : tab === 'recent' && showRecent ? 'recent' : 'folder'
  const activeTab = selectedTab ?? standaloneTab

  const visiblePreview = openedOn === activeTab ? opened : null

  // 写入条目操作只在文件夹标签、没有预览时可用；离开这个状态或换了文件夹时结束编辑
  const editable = condition.writable && activeTab === 'folder' && !visiblePreview
  const setEditing = (next: EntryEdit | null) => {editRef.current = next; setEdit(next)}
  useEffect(() => {
    if (!editable) {setEditing(null); setRemoving(null)}
  }, [editable, folder?.root_id])

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

  // 仅打开文件夹面板且有后台索引任务时刷新进度。
  useEffect(() => {
    if (!condition.folderAvailable) {setIndexSummary(null); setIndexStates(new Map()); setIndexError(null); return}
    if (!visible || activeTab !== 'folder') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      const [summary, documents] = await Promise.allSettled([documentsApi.summary(workspace.id), documentsApi.list(workspace.id)])
      if (cancelled) return
      const index = summary.status === 'fulfilled' ? summary.value : null
      if (index) setIndexSummary(index)
      if (documents.status === 'fulfilled') setIndexStates(new Map(documents.value.map(item => [item.relative_path, item.status])))
      setIndexError(summary.status === 'rejected' || documents.status === 'rejected' ? '索引状态读取失败' : null)
      timer = setTimeout(() => void read(), index?.active_operation_id ? 2000 : 15000)
    }
    void read()
    return () => {cancelled = true; clearTimeout(timer)}
  }, [workspace.id, condition.folderAvailable, visible, activeTab, live.change.signal, uploading, indexAttempt])

  // 正在预览的文件被报告变化：提示重新载入，不自动替换用户正在看的内容
  useEffect(() => {
    if (opened?.kind === 'root' && touchesFile(live.change.batch, opened.path)) setStale(true)
  }, [live.change]) // eslint-disable-line react-hooks/exhaustive-deps -- 只由新批次触发
  const open = (source: PreviewSource | null) => {
    setStale(false)
    setOpened(source)
    if (source) setOpenedOn(activeTab)
  }

  // 条目被删除或改名后：预览与选中若落在该路径（含其下的文件）上则清理；改名时选中项跟随到新路径
  const forgetPath = (path: string, renamedTo?: string) => {
    const within = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`)
    setSelected(current => {
      if (!current || !within(current.path)) return current
      return renamedTo && current.path === path ? {path: renamedTo, kind: current.kind} : null
    })
    setOpened(current => current?.kind === 'root' && within(current.path) ? null : current)
  }

  const startCreate = (directory: string) => {
    if (directory) toggle(directory, true)
    setSelected(directory ? {path: directory, kind: 'directory'} : null)
    setEditing(createEdit(directory))
  }
  const startRename = (path: string, entry: RootEntry) => {
    setSelected({path, kind: entry.kind})
    setEditing(renameEdit(path, entry))
  }
  const cancelEdit = () => setEditing(null)

  const commitEdit = async (fromBlur: boolean) => {
    const current = editRef.current
    if (!current || busyRef.current) return
    // 失焦且没有内容：视为取消，不报错
    if (fromBlur && !current.draft.trim()) {cancelEdit(); return}
    const fail = (message: string) => setEditing({...current, error: message})
    if (current.kind === 'create') {
      const check = checkNewName(current.draft)
      if (!check.ok) {fail(check.message); return}
      busyRef.current = true
      setEditBusy(true)
      try {
        await ops.createFolder(current.directory, check.name)
        setEditing(null)
        setSelected({path: joinPath(current.directory, check.name), kind: 'directory'})
      } catch (error) {
        fail(error instanceof Error ? error.message : '新建失败，请重试')
      } finally {
        busyRef.current = false
        setEditBusy(false)
      }
      return
    }
    const check = checkRenameName(current.entry.name, current.draft)
    if (!check.ok) {fail(check.message); return}
    // 名称没有变化：直接结束编辑
    if (!check.changed) {cancelEdit(); return}
    busyRef.current = true
    setEditBusy(true)
    const from = current.path
    const to = joinPath(parentPath(from), check.name)
    try {
      await ops.rename(from, current.entry, check.name)
      setEditing(null)
      forgetPath(from, to)
    } catch (error) {
      fail(error instanceof Error ? error.message : '改名失败，请重试')
    } finally {
      busyRef.current = false
      setEditBusy(false)
    }
  }

  const removeEntry = async (victim: {path: string; entry: RootEntry}) => {
    await ops.remove(victim.path, victim.entry)
    forgetPath(victim.path)
  }

  const upload = async (files: File[], directory = target) => {
    if (!files.length) return
    if (!folder || !condition.writable || uploading) {
      toast.error(uploading ? '正在添加文件，请稍后再试' : '当前无法写入工作区文件夹')
      return
    }
    setUploading(true)
    const saved: Array<{asked: string; saved: string}> = []
    const failed: Array<{name: string; message: string}> = []
    for (const file of files) {
      try {
        const entry = await rootApi.upload(folder.root_id, file, directory)
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
      setAddedPaths(current => new Set([...current, ...saved.map(item => directory ? `${directory}/${item.saved}` : item.saved)]))
      if (directory) toggle(directory, true)
      void loadDirectory(directory)
    }
  }

  useImperativeHandle(ref, () => ({
    target,
    closePreview: () => open(null),
    addFiles: (files, directory) => {open(null); void upload(files, directory)},
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

  const chooseFiles = (directory = target) => {
    if (!folder || !condition.writable || uploading || !picker.current) return
    pickerDestination.current = {rootId: folder.root_id, directory}
    picker.current.click()
  }

  // 在系统文件管理器中显示：预览中的文件、否则树里选中的条目、否则文件夹本身；只有桌面宿主能做到，浏览器开发模式不提供
  const copyPath = (path: string) => folder ? copyText(absolutePath(folder.path, path)) : undefined

  const revealPath = visiblePreview ? (visiblePreview.kind === 'root' ? visiblePreview.path : null) : activeTab === 'folder' ? selected?.path ?? '' : null
  const canReveal = isDesktop() && !!folder && condition.folderAvailable
  const reveal = async (path: string) => {
    if (!canReveal || !folder) return
    try {await revealInFileManager(folder.root_id, path)}
    catch (error) {toast.error(error instanceof Error ? error.message : '无法显示位置')}
  }

  const toggleFileIndex = async (path: string) => {
    if (!indexSummary || !condition.writable) return
    const action = fileIndexAction(path, indexSummary)
    if (!action) return
    const current = normalizePolicy(indexSummary.policy)
    const next = action.kind === 'exclude'
      ? excludeFile(current, path)
      : includeFile(current, path, action.needsExplicitInclude)
    try {
      const updated = await documentsApi.policy(workspace.id, next)
      setIndexSummary(updated)
      setIndexAttempt(value => value + 1)
      const name = path.split('/').at(-1) ?? path
      toast.success(action.kind === 'exclude' ? `已从索引排除「${name}」` : `已将「${name}」纳入索引`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新索引范围失败')
    }
  }

  const toggleDirectoryIndex = async (directory: string) => {
    if (!indexSummary || !condition.writable) return
    const action = directoryIndexAction(directory, indexSummary)
    const current = normalizePolicy(indexSummary.policy)
    const next = action === 'exclude'
      ? excludeDirectory(current, directory)
      : includeDirectory(current, directory)
    try {
      const updated = await documentsApi.policy(workspace.id, next)
      setIndexSummary(updated)
      setIndexAttempt(value => value + 1)
      toast.success(action === 'exclude' ? `已从索引排除 ${directory}/` : `已恢复索引 ${directory}/`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新索引范围失败')
    }
  }

  const folderActions = <FolderToolbarActions directory={target || folder?.path || '文件夹根目录'} adding={uploading} collapsible={embedded}
    onAdd={editable ? () => chooseFiles() : undefined}
    onNewFolder={editable && !uploading ? () => startCreate(target) : undefined}
    revealLabel={`在 ${fileManagerName()} 中显示${revealPath ? '' : '文件夹'}`}
    onReveal={canReveal && revealPath !== null ? () => void reveal(revealPath) : undefined}/>

  const header = <header className={cn('flex shrink-0 items-center gap-1 px-2.5', embedded ? 'min-h-9' : 'min-h-12 border-b')}>
    <div className="min-w-0 flex-1">
      <h2 className={cn('truncate font-medium', embedded ? 'text-xs text-muted-foreground' : 'text-sm')} dir="auto" title={folder?.path}>{folder ? folderName(folder.path) : '文件夹'}</h2>
    </div>
    {onOpenWorkingStyle && <IconAction label="工作方式" onClick={onOpenWorkingStyle} className="text-muted-foreground"><ScrollText className="size-4" aria-hidden/></IconAction>}
    {folderActions}
    {onClose && <IconAction label="收起文件夹面板" onClick={onClose} className="text-muted-foreground"><X className="size-4" aria-hidden/></IconAction>}
  </header>

  let body: ReactNode
  if (visiblePreview) {
    body = <div className="flex min-h-0 flex-1 flex-col">
      {stale && <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-state-waiting-soft px-3 py-2 text-xs">
        <span className="min-w-0 flex-1">这个文件刚被修改或删除。</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => {setStale(false); setRevision(value => value + 1)}}>重新载入</Button>
      </div>}
      <div className="min-h-0 flex-1"><FilePreview key={revision} source={visiblePreview}
        backLabel={visiblePreview === initialPreview && onBackToKnowledge ? '返回检索结果' : undefined}
        onBack={visiblePreview === initialPreview && onBackToKnowledge ? onBackToKnowledge : () => open(null)}/></div>
    </div>
  } else if (activeTab === 'delivered') {
    body = <ScrollArea className="min-h-0 flex-1"><div className="px-3 pb-3">
      {deliveryStatus?.error ? <div className="space-y-1 px-2 py-6 text-center">
        <p role="alert" className="text-meta text-state-failed">{deliveryStatus.error}</p>
        <Button size="xs" variant="ghost" onClick={deliveryStatus.retry}>重试</Button>
      </div> : deliveryStatus?.loading ? <p role="status" className="px-2 py-8 text-center text-meta text-muted-foreground">正在读取最近对话的交付…</p>
        : deliveries?.length ? <h2 className="px-1.5 py-1.5 text-xs font-medium text-faint">{deliveryLabel}</h2>
        : <p className="px-2 py-8 text-center text-meta text-muted-foreground">{deliveryEmpty}</p>}
      {deliveries?.map(file => {
        const rootId = folder?.root_id
        const inFolder = rootId && file.rootId === rootId && file.relativePath ? file.relativePath : null
        // 右键菜单与「更多」菜单共用这一份定义
        const entries: MenuEntry[] = [
          ...(rootId && inFolder ? [menuItem('查看文件夹中的当前版本', FolderSearch,
            () => open({kind: 'root', rootId, path: inFolder, filename: file.filename, size: null}))] : []),
          ...(canReveal && inFolder ? [menuItem(`在 ${fileManagerName()} 中显示`, Finder, () => reveal(inFolder))] : []),
          menuItem('下载交付版本', Download, async () => {
            try {await downloadPreviewSource({kind: 'attachment', id: file.id, filename: file.filename})}
            catch (error) {toast.error(error instanceof Error ? error.message : '下载失败')}
          }),
          menuItem('复制文件名', Copy, () => copyText(file.filename)),
        ]
        return <FileRow key={file.id} file={file} versionLabel="交付版本" menu={entries}
          onOpen={() => onOpenDelivery ? onOpenDelivery(file) : open({kind: 'attachment', id: file.id, filename: file.filename, size: file.size})}
          actions={<DropdownMenu>
            <DropdownMenuTrigger asChild><IconAction label={`${file.filename} 的操作`}><MoreHorizontal/></IconAction></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <MenuEntryItems entries={entries}/>
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
    // 文件树以外的空白区域：添加、新建、显示与复制根目录（树的行先接管自己的右键）
    const blankEntries: MenuEntry[] = [
      ...(condition.writable && !uploading ? [menuItem('添加文件到此处', Plus, () => chooseFiles(''))] : []),
      ...(editable && !uploading ? [menuItem('新建文件夹', FolderPlus, () => startCreate(''))] : []),
      ...(canReveal ? [menuItem(`在 ${fileManagerName()} 中显示`, Finder, () => void reveal(''))] : []),
      ...(folder ? [menuItem('复制路径', Copy, () => copyPath(''))] : []),
    ]
    body = <>
      <ContextMenuSurface items={blankEntries} includeEditing><div className="contents"><ScrollArea className={cn('min-h-0 flex-1', embedded && 'px-2 pt-0.5')}>
        <FolderTree tree={tree} selectedPath={selected?.path ?? null} indexStates={indexStates} indexSummary={indexSummary} readPaths={readPaths} addedPaths={addedPaths}
          onToggle={toggle} onRetry={path => void loadDirectory(path)}
          onReveal={canReveal ? path => void reveal(path) : undefined}
          onAdd={condition.writable && !uploading ? chooseFiles : undefined}
          onToggleFileIndex={condition.writable && indexSummary ? path => void toggleFileIndex(path) : undefined}
          onToggleDirectoryIndex={condition.writable && indexSummary ? dir => void toggleDirectoryIndex(dir) : undefined}
          onSelect={(path, entry) => {
            setSelected({path, kind: entry.kind})
            if (entry.kind === 'file') openRoot(path, entry)
          }}
          edit={edit} editBusy={editBusy}
          onEditChange={draft => {const current = editRef.current; if (current) setEditing({...current, draft, error: undefined})}}
          onEditCommit={fromBlur => void commitEdit(fromBlur)}
          onEditCancel={cancelEdit}
          onStartRename={editable && !uploading ? startRename : undefined}
          onStartCreate={editable && !uploading ? startCreate : undefined}
          onRequestDelete={editable && !uploading ? (path, entry) => setRemoving({path, entry}) : undefined}
          onCopyPath={folder ? copyPath : undefined}/>
      </ScrollArea></div></ContextMenuSurface>
      {(indexSummary || indexError) && <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/65 px-3.5 py-2 text-xs text-faint" title="文档全文索引状态">
        {indexSummary && <>
          <span className="tabular-nums">可检索 {indexSummary.searchable}/{indexSummary.total}</span>
          {indexSummary.total > 0 && <progress aria-label="可检索文档" className="folder-index-progress" max={indexSummary.total} value={indexSummary.searchable}/>}
          {remainingIndexStatus(indexSummary) && <span>{remainingIndexStatus(indexSummary)}</span>}
        </>}
        <Link href={`${workspaceKnowledgeHref(workspace.id)}?view=index`} className="ml-auto hover:underline">索引详情</Link>
        {indexError && <span role="status" className="text-state-failed">{indexError}
          <Button size="xs" variant="ghost" onClick={() => setIndexAttempt(value => value + 1)}>重试</Button></span>}
      </div>}
    </>
  }

  return <aside aria-label="文件夹面板"
    onDragOver={event => {if (condition.writable && activeTab === 'folder' && !visiblePreview && event.dataTransfer.types.includes('Files')) {event.preventDefault(); setDragging(true)}}}
    onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)}}
    onDrop={onDrop}
    className={cn('relative flex min-h-0 flex-col bg-background', dragging && 'ring-2 ring-inset ring-signal', className)}>
    {!embedded && header}
    {embedded && visible && toolbarTarget && createPortal(folderActions, toolbarTarget)}
    <input ref={picker} type="file" multiple hidden onChange={event => {
      const files = Array.from(event.target.files ?? [])
      const destination = pickerDestination.current
      pickerDestination.current = null
      event.target.value = ''
      if (destination && destination.rootId === folder?.root_id) void upload(files, destination.directory)
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
    <DeleteEntryDialog target={removing} onClose={() => setRemoving(null)} onConfirm={removeEntry}/>
  </aside>
}
