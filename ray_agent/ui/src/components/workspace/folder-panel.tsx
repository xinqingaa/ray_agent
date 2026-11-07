import {useEffect, useRef, useState, type DragEvent, type ReactNode} from 'react'
import {Download, FolderSearch, FolderX, Plus, RefreshCw, SquareArrowOutUpRight, X} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {ScrollArea} from '@/components/ui/scroll-area'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {FilePreview} from '@/components/preview/file-preview'
import {FileRow} from '@/components/preview/file-row'
import {useFolderTree} from '@/hooks/use-folder-tree'
import {ApiError} from '@/lib/api/fetch'
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

type PanelTab = 'folder' | 'delivered' | 'recent'

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
export function FolderPanel({workspace, deliveries, onClose, embedded = false, className}: {
  workspace: WorkspaceItem
  /** 会话里的交付文件；工作区首页没有会话，传空则不显示“本次成果” */
  deliveries?: FileView[]
  onClose?: () => void
  /** 嵌在带切换栏的面板里时用更矮的标题行 */
  embedded?: boolean
  className?: string
}) {
  const folder = workspace.folder
  const condition = describeWorkspace(workspace)
  const [tab, setTab] = useState<PanelTab>('folder')
  const live = useWorkspaceLive()
  const titleOf = useSessionTitleLookup()
  const [opened, setOpened] = useState<PreviewSource | null>(null)
  const [stale, setStale] = useState(false)
  const [revision, setRevision] = useState(0)
  const [runs, setRuns] = useState<ModifiedRun[]>([])
  const [selected, setSelected] = useState<{path: string; kind: RootEntry['kind']} | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const {tree, toggle, reload, loadDirectory} = useFolderTree(folder?.root_id ?? null, condition.folderAvailable, live.change)
  const target = uploadTarget(selected)
  const showDelivered = deliveries != null
  const showRecent = condition.writable && runs.length > 0
  const activeTab: PanelTab = tab === 'delivered' && showDelivered ? 'delivered' : tab === 'recent' && showRecent ? 'recent' : 'folder'

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

  // 正在预览的文件被报告变化：提示重新载入，不自动替换用户正在看的内容
  useEffect(() => {
    if (opened?.kind === 'root' && touchesFile(live.change.batch, opened.path)) setStale(true)
  }, [live.change]) // eslint-disable-line react-hooks/exhaustive-deps -- 只由新批次触发
  const open = (source: PreviewSource | null) => {
    setStale(false)
    setOpened(source)
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
      if (target) toggle(target, true)
      void loadDirectory(target)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (condition.writable && activeTab === 'folder' && !opened) void upload(Array.from(event.dataTransfer.files))
  }

  const openRoot = (path: string, entry: RootEntry) => {
    if (!folder) return
    open({kind: 'root', rootId: folder.root_id, path, filename: entry.name, size: entry.size})
  }

  // 在系统文件管理器中显示：预览中的文件、否则树里选中的条目、否则文件夹本身；只有桌面宿主能做到，浏览器开发模式不提供
  const revealPath = opened ? (opened.kind === 'root' ? opened.path : null) : activeTab === 'folder' ? selected?.path ?? '' : null
  const revealable = isDesktop() && !!folder && condition.folderAvailable && revealPath != null
  const reveal = async () => {
    if (!folder || revealPath == null) return
    try {await revealInFileManager(folder.root_id, revealPath)}
    catch (error) {toast.error(error instanceof Error ? error.message : '无法显示位置')}
  }

  const header = <header className={cn('flex shrink-0 items-center gap-1 border-b pl-3 pr-2', embedded ? 'h-10' : 'h-12')}>
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-sm font-medium" dir="auto" title={folder?.path}>{folder ? folderName(folder.path) : '文件夹'}</h2>
    </div>
    {revealable && <IconAction label={`在 ${fileManagerName()} 中显示${revealPath ? '' : '文件夹'}`} onClick={() => void reveal()} className="text-muted-foreground"><SquareArrowOutUpRight className="size-4" aria-hidden/></IconAction>}
    {condition.folderAvailable && activeTab === 'folder' && !opened && <IconAction label="刷新" onClick={reload} className="text-muted-foreground"><RefreshCw className="size-4" aria-hidden/></IconAction>}
    {onClose && <IconAction label="收起文件夹面板" onClick={onClose} className="text-muted-foreground"><X className="size-4" aria-hidden/></IconAction>}
  </header>

  let body: ReactNode
  if (opened) {
    body = <div className="flex min-h-0 flex-1 flex-col">
      {stale && <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-state-waiting-soft px-3 py-2 text-xs">
        <span className="min-w-0 flex-1">这个文件刚被修改或删除。</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => {setStale(false); setRevision(value => value + 1)}}>重新载入</Button>
      </div>}
      <div className="min-h-0 flex-1"><FilePreview key={revision} source={opened} onBack={() => open(null)}/></div>
    </div>
  } else if (activeTab === 'delivered') {
    body = <ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">
      {deliveries && deliveries.length === 0 && <p className="px-2 py-8 text-center text-meta text-muted-foreground">这个对话还没有交付文件。</p>}
      {deliveries?.map(file => {
        const rootId = folder?.root_id
        const inFolder = rootId && file.rootId === rootId && file.relativePath ? file.relativePath : null
        return <FileRow key={file.id} file={file}
          onOpen={() => open({kind: 'attachment', id: file.id, filename: file.filename, size: file.size})}
          actions={<>
            {rootId && inFolder && <IconAction label="查看文件夹中的当前版本" className="text-muted-foreground"
              onClick={() => open({kind: 'root', rootId, path: inFolder, filename: file.filename, size: null})}><FolderSearch className="size-4" aria-hidden/></IconAction>}
            <IconAction label="下载交付版本" className="text-muted-foreground"
              onClick={() => void downloadPreviewSource({kind: 'attachment', id: file.id, filename: file.filename}).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))}><Download className="size-4" aria-hidden/></IconAction>
          </>}>
          {inFolder && <span className="block truncate font-mono text-xs text-muted-foreground" title={inFolder}>{inFolder}</span>}
        </FileRow>
      })}
    </div></ScrollArea>
  } else if (activeTab === 'recent') {
    body = <ScrollArea className="min-h-0 flex-1"><div className="space-y-2 p-2">
      <p className="px-1 text-xs text-muted-foreground">最近改过这个文件夹的运行与撤销操作。撤销只恢复文件内容，不改变对话；撤销也可以再撤回。</p>
      <RecentChanges workspaceId={workspace.id} runs={runs}/>
    </div></ScrollArea>
  } else if (!folder || !condition.folderAvailable) {
    body = <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderX className="size-6 text-muted-foreground" aria-hidden/>
      <p className="text-sm font-medium">文件夹暂时不可用</p>
      <p className="text-meta text-muted-foreground">{folder ? <span className="break-all">{folder.path}</span> : '这个工作区没有绑定文件夹。'}</p>
    </div>
  } else {
    body = <>
      <ScrollArea className="min-h-0 flex-1">
        <FolderTree tree={tree} selectedPath={selected?.path ?? null} onToggle={toggle} onRetry={path => void loadDirectory(path)}
          onSelect={(path, entry) => {
            setSelected({path, kind: entry.kind})
            if (entry.kind === 'file') openRoot(path, entry)
          }}/>
      </ScrollArea>
      <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
        {condition.writable ? <>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={target || undefined}>添加到 {target ? <span className="font-mono">{target}</span> : '文件夹根目录'}</p>
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => picker.current?.click()}>
            <Plus aria-hidden/>{uploading ? '正在添加' : '添加文件'}
          </Button>
          <input ref={picker} type="file" multiple hidden onChange={event => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void upload(files)
          }}/>
        </> : <p className="text-xs text-muted-foreground">{condition.archived ? '工作区已归档，不能再添加文件。' : '工作区不可写，不能添加文件。'}</p>}
      </footer>
    </>
  }

  return <aside aria-label="文件夹面板"
    onDragOver={event => {if (condition.writable && activeTab === 'folder' && !opened && event.dataTransfer.types.includes('Files')) {event.preventDefault(); setDragging(true)}}}
    onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)}}
    onDrop={onDrop}
    className={cn('relative flex min-h-0 flex-col bg-background', dragging && 'ring-2 ring-inset ring-signal', className)}>
    {header}
    {(showDelivered || showRecent) && !opened && <div className="shrink-0 border-b px-3 py-2">
      <SegmentedControl<PanelTab> value={activeTab} onValueChange={setTab} label="文件夹面板视图" className="w-full"
        options={[
          {value: 'folder', label: '文件夹'},
          ...(deliveries ? [{value: 'delivered' as const, label: deliveries.length ? `本次成果 ${deliveries.length}` : '本次成果'}] : []),
          ...(showRecent ? [{value: 'recent' as const, label: '最近修改'}] : []),
        ]}/>
    </div>}
    {body}
  </aside>
}
