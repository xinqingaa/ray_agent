import {useEffect, useRef, useState, type ReactNode} from 'react'
import {Link, useParams, useRouter} from '@/lib/navigation'
import {Outlet, useLocation, useNavigate, useOutletContext} from 'react-router'
import {toast} from 'sonner'
import {Bookmark, File, Layers, PanelRight, ScrollText} from '@/components/ui/icons'
import {IconAction} from '@/components/ui/icon-action'
import {TopbarActions} from '@/components/sidebar-chrome'
import {TaskInspector, TaskInspectorTabs, TaskLayout, useTaskInspector, type InspectorView} from '@/components/task-layout'
import {WorkspaceList} from '@/components/workspace/workspace-list'
import {MemoryPanel, type BackgroundMemorySummary} from '@/components/workspace/memory-panel'
import {sessionApi} from '@/lib/api/session'
import {useSessions} from '@/hooks/use-sessions'
import type {FileView} from '@/lib/session-view'
import {projectSession} from '@/lib/session-projection'
import {formatSidebarTime} from '@/lib/utils'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {SessionDetailView} from '@/components/session-detail-view'
import {Button} from '@/components/ui/button'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {Skeleton} from '@/components/ui/skeleton'
import {WorkspaceBanners} from '@/components/workspace/workspace-banners'
import {WorkspaceBar} from '@/components/workspace/workspace-bar'
import {FolderPanel, type FolderPanelRef} from '@/components/workspace/folder-panel'
import {WorkingStyleSettings, type WorkingStyleSummary} from '@/components/workspace/working-style-settings'
import {RunChangesBar} from '@/components/workspace/run-changes-bar'
import {useCanonicalSessionRoute} from '@/hooks/use-canonical-session-route'
import {useStartTask} from '@/hooks/use-start-task'
import {workspaceDraftScope} from '@/lib/drafts'
import type {WorkspaceItem} from '@/lib/api/types'
import type {RootSource} from '@/lib/api/preview'
import {describeWorkspace} from '@/lib/workspace-state'
import {workspaceBackgroundHref, workspaceKnowledgeHref, workspaceSessionHref} from '@/lib/workspace-route'
import {WorkspaceLiveProvider, useWorkspaceLive} from '@/providers/workspace-live-provider'
import {useWorkspace, useWorkspaces} from '@/providers/workspaces-provider'
import {useWorkspacePending} from '@/providers/workspace-pending'

function Message({title, detail, children}: {title: string; detail?: string; children?: ReactNode}) {
  return <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <p className="text-sm font-medium">{title}</p>
    {detail && <p className="max-w-md text-meta text-muted-foreground">{detail}</p>}
    {children}
  </main>
}

/** 工作区路由的外壳：位置条与状态横幅，覆盖读取中、不存在、读取失败与正在删除。 */
export function WorkspaceLayout() {
  const {id = ''} = useParams()
  const lookup = useWorkspace(id)
  const {refresh} = useWorkspaces()

  if (lookup.phase === 'loading') return <div role="status" aria-label="正在读取工作区" className="space-y-3 p-6">
    <Skeleton className="h-6 w-48"/><Skeleton className="h-24 w-full max-w-(--reading-column)"/>
  </div>
  if (lookup.phase === 'missing') return <Message title="没有找到这个工作区" detail="它可能已被删除。绑定的文件夹和文件不受影响。">
    <Button asChild variant="outline" size="sm"><Link href="/workspaces">返回工作区</Link></Button>
  </Message>
  if (lookup.phase === 'error') return <Message title="读取工作区失败" detail={lookup.message}>
    <Button variant="outline" size="sm" onClick={() => void refresh()}>重试</Button>
  </Message>
  const workspace = lookup.workspace
  if (workspace.status === 'deleting') return <Message title="这个工作区正在删除" detail="清理完成后会从列表中消失，文件夹与其中的文件不受影响。">
    <Button asChild variant="outline" size="sm"><Link href="/workspaces">返回工作区</Link></Button>
  </Message>
  return <WorkspaceLiveProvider workspace={workspace}>
    <div className="workspace-surface flex h-full min-h-0 flex-col">
      <WorkspaceBar workspace={workspace}/>
      <WorkspaceBanners workspace={workspace}/>
      <div className="min-h-0 flex-1"><Outlet context={workspace}/></div>
    </div>
  </WorkspaceLiveProvider>
}

const useWorkspaceContext = () => useOutletContext<WorkspaceItem>()

export function WorkspaceDirectoryPage() {
  return <main className="flex min-h-0 flex-col overflow-y-auto px-5 py-8 sm:px-9">
    <WorkspaceList/>
  </main>
}

export function WorkspaceBackgroundPage() {
  const workspace = useWorkspaceContext()
  return <WorkspaceBackgroundContent key={workspace.id} workspace={workspace}/>
}

const BACKGROUND_VIEWS = [
  {value: 'style', label: '工作方式', icon: ScrollText},
  {value: 'memory', label: '记忆', icon: Bookmark},
] as const

function WorkspaceBackgroundContent({workspace}: {workspace: WorkspaceItem}) {
  const [style, setStyle] = useState<WorkingStyleSummary | null>(null)
  const [memory, setMemory] = useState<BackgroundMemorySummary | null>(null)
  const {report} = useWorkspacePending()
  const {pathname, search, hash} = useLocation()
  const navigate = useNavigate()
  const view = hash.startsWith('#memory-') || new URLSearchParams(search).get('view') === 'memory' ? 'memory' : 'style'
  const pending = style && memory ? style.pending + memory.pending : null

  useEffect(() => {if (pending != null) report(pending)}, [pending, report])

  return <main aria-label="背景" className="workspace-detail-root">
    <div className="workspace-detail-head">
      <SegmentedControl idPrefix="background-view" label="背景视图" options={BACKGROUND_VIEWS} value={view}
        appearance="icons" onValueChange={next => {
          if (next === view) return
          const updated = new URLSearchParams(search)
          if (next === 'memory') updated.set('view', 'memory')
          else updated.delete('view')
          void navigate({pathname, search: updated.toString(), hash: ''})
        }}/>
      {pending != null && pending > 0 && <span className="text-xs text-state-waiting">
        {style && style.pending > 0 && <span>{style.pending} 项工作方式建议</span>}
        {style && memory && style.pending > 0 && memory.pending > 0 && ' · '}
        {memory && memory.pending > 0 && <span>{memory.pending} 条记忆待确认</span>}
      </span>}
    </div>
    <div id="background-view-panel-style" role="tabpanel" aria-labelledby="background-view-style"
      hidden={view !== 'style'} className="background-view">
      <div className="background-page"><WorkingStyleSettings workspace={workspace} onSummary={setStyle}/></div>
    </div>
    <div id="background-view-panel-memory" role="tabpanel" aria-labelledby="background-view-memory"
      hidden={view !== 'memory'} className="background-view">
      <div className="background-page"><MemoryPanel workspace={workspace} onSummary={setMemory}/></div>
    </div>
  </main>
}

/** 工作区首页通过当前范围的会话目录展示最近活动。 */
export function WorkspaceHomePage() {
  const workspace = useWorkspaceContext()
  const router = useRouter()
  const location = useLocation()
  const openFromKnowledge = location.state as {folderPreview?: RootSource; knowledgeSearch?: string} | null
  const requested = openFromKnowledge?.folderPreview
  const initialPreview = requested?.kind === 'root' && requested.rootId === workspace.folder?.root_id ? requested : undefined
  const {open, setOpen, floating} = useTaskInspector(true, Boolean(initialPreview))
  const input = useRef<ChatInputRef>(null)
  const inspectorTrigger = useRef<HTMLButtonElement>(null)
  const folderPanel = useRef<FolderPanelRef>(null)
  const [tab, setTab] = useState<InspectorView>('folder')
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const condition = describeWorkspace(workspace)
  const scope = workspaceDraftScope(workspace.id)
  const {sending, start} = useStartTask(scope, workspace.id, sid => router.push(workspaceSessionHref(workspace.id, sid)))
  const {sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions} = useSessions()
  const {count: pending} = useWorkspacePending()
  const [result, setResult] = useState<{key: string; files?: FileView[]; error?: string} | null>(null)
  const [retry, setRetry] = useState(0)
  const recentSession = sessions[0]
  const recentSessionId = recentSession?.session_id
  const deliveryKey = JSON.stringify([recentSessionId, recentSession?.latest_message_at, recentSession?.status, retry])

  useEffect(() => {
    if (!recentSessionId) return
    let cancelled = false
    void sessionApi.getSessionDetail(recentSessionId).then(detail => {
      const {files} = projectSession({id: recentSessionId, runs: detail.runs ?? [], events: detail.events ?? []})
      if (!cancelled) setResult({key: deliveryKey, files: files.filter(file => file.source === 'delivery')})
    }).catch(error => {
      if (!cancelled) setResult({key: deliveryKey, error: error instanceof Error ? error.message : '读取交付失败'})
    })
    return () => {cancelled = true}
  }, [recentSessionId, deliveryKey])

  const deliveryResult = recentSessionId && result?.key === deliveryKey ? result : null
  const deliveries = deliveryResult?.files
  const retryDeliveries = () => sessionsError ? void refreshSessions() : setRetry(value => value + 1)
  const delivery = deliveries?.[0]

  return <>
    <TopbarActions><IconAction ref={inspectorTrigger} label={open ? '收起右侧面板' : '打开右侧面板'}
      aria-expanded={open} className="topbar-action" onClick={() => setOpen(!open)}><PanelRight/></IconAction></TopbarActions>
    <TaskLayout key={workspace.id} workspace folderRootId={condition.writable ? workspace.folder?.root_id : undefined}
      attach={condition.archived || condition.deleting || sending ? undefined : files => input.current?.addFiles(files)}
      addToFolder={condition.writable ? (files, directory) => {
        folderPanel.current?.addFiles(files, directory)
        setTab('folder')
        setOpen(true)
      } : undefined}
      inspector={<TaskInspector open={open} onClose={() => setOpen(false)} floating={floating} label="右侧面板" triggerRef={inspectorTrigger}>
        <TaskInspectorTabs value={tab} workspace onChange={next => {folderPanel.current?.closePreview(); setTab(next)}} onActions={setToolbarTarget}
          onClose={floating ? () => {setOpen(false); inspectorTrigger.current?.focus()} : undefined}/>
        <FolderPanel ref={folderPanel} workspace={workspace} selectedTab={tab === 'workbench' ? 'inspect' : tab} embedded
          initialPreview={initialPreview}
          onBackToKnowledge={initialPreview && typeof openFromKnowledge?.knowledgeSearch === 'string' ? () =>
            router.replace(`${workspaceKnowledgeHref(workspace.id)}?${openFromKnowledge.knowledgeSearch}`) : undefined}
          toolbarTarget={toolbarTarget} visible={open}
          deliveries={deliveries}
          deliveryStatus={{loading: sessionsLoading || (!!recentSessionId && !deliveryResult), error: deliveryResult?.error ?? sessionsError, retry: retryDeliveries}}
          onOpenDelivery={file => {if (recentSessionId) router.push(`${workspaceSessionHref(workspace.id, recentSessionId)}?delivery=${encodeURIComponent(file.id)}`)}}
          deliveryLabel="最近对话的交付" deliveryEmpty="最近对话暂无交付文件。"
          className="min-h-0 flex-1"/>
      </TaskInspector>}>
      <main className="task-home" aria-labelledby="workspace-home-title">
        <div className="task-home-content">
          <header className="task-home-heading">
            <h1 id="workspace-home-title" dir="auto">{workspace.name}</h1>
            {workspace.folder && <p className="font-mono" dir="auto">{workspace.folder.path}</p>}
          </header>
          {condition.archived
            ? <p role="status" className="rounded-lg bg-muted px-3.5 py-3 text-center text-sm text-muted-foreground">工作区已归档，不能发起新对话。取消归档后可以继续。</p>
            : <ChatInput ref={input} autoFocus={!initialPreview} workspace draftScope={scope} onSend={start} disabled={sending}
                placeholder={`在${workspace.name}里开始一个任务`}
                commandHost={{
                  hasSession: false, hasRuns: false, runStatus: 'idle', waitingApproval: false, waitingReply: false,
                  submitting: sending, compacting: false,
                  actions: {compact: () => toast.message('还没有可压缩的上下文')},
                }}/>}
          {((pending ?? 0) > 0 || delivery) && <div className="task-home-links">
            {pending != null && pending > 0 && <Link href={workspaceBackgroundHref(workspace.id)} className="home-shortcut">
              <Layers/>背景有 {pending} 项待处理</Link>}
            {delivery && recentSession && <Link href={`${workspaceSessionHref(workspace.id, recentSession.session_id)}?delivery=${encodeURIComponent(delivery.id)}`} className="home-shortcut" title="查看交付版本">
              <File/>{delivery.filename}</Link>}
          </div>}
          <section aria-labelledby="workspace-recent" className="task-home-recent">
            <h2 id="workspace-recent" className="pb-1 text-xs text-faint">最近对话</h2>
            {sessionsError && <div role="alert" className="flex items-center gap-2 text-xs text-state-failed">
              {sessionsError}<Button size="xs" variant="ghost" onClick={() => void refreshSessions()}>重试</Button>
            </div>}
            {!sessions.length && !sessionsError && <p className="py-1 text-meta text-muted-foreground">
              {sessionsLoading ? '正在读取对话…' : '还没有对话'}
            </p>}
            {sessions.slice(0, 5).map(session => <Link key={session.session_id} href={workspaceSessionHref(workspace.id, session.session_id)}
              className="workspace-directory-row text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{session.title || '新对话'}</span>
              <span className="shrink-0 text-xs text-faint tabular-nums">{formatSidebarTime(session.latest_message_at)}</span>
            </Link>)}
          </section>
        </div>
      </main>
    </TaskLayout>
  </>
}

/** 工作区里的会话：复用会话视图，右侧面板在文件夹与工作台之间切换；运行结束条带撤销入口。 */
export function WorkspaceSessionPage() {
  const workspace = useWorkspaceContext()
  const {change} = useWorkspaceLive()
  const {sid = ''} = useParams()
  useCanonicalSessionRoute(sid, workspace.id)
  return <SessionDetailView key={sid} sessionId={sid} workspace={workspace} sourceRefresh={change.signal}
    renderRunActions={runId => <RunChangesBar key={runId} workspace={workspace} runId={runId}/>}/>
}
