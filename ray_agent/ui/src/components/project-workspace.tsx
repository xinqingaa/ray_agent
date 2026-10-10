'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {MoreHorizontal, FolderOpen, FileText, NotebookPen} from 'lucide-react'
import {ProjectFolderIcon, NewChatIcon} from '@/components/nav-icons'
import {ProjectFilesPage} from '@/components/project-files-page'
import {ProjectMemoryPage} from '@/components/project-memory-page'
import {DataCleanupDialog} from '@/components/data-cleanup-dialog'
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {ChatInput} from '@/components/chat-input'
import {ProjectMemoryPanel} from '@/components/project-memory-panel'
import {ProjectSettingsDialog} from '@/components/project-settings-dialog'
import {ManagedProjectPane} from '@/components/workbench/managed-project-pane'
import {ProjectStateNotice} from '@/components/project-state-notice'
import {useProjects} from '@/providers/projects-provider'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import {sessionApi} from '@/lib/api/session'
import {ApiError} from '@/lib/api/fetch'
import type {FileInfo, ProjectDetails, Session} from '@/lib/api/types'
import {startProjectRecoverably} from '@/lib/send-recovery'
import {SessionItem} from '@/components/session-item'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'

export function ProjectWorkspace({projectId}: {projectId: string}) {
  const router = useRouter()
  const registry = useProjects()
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [total, setTotal] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [settings, setSettings] = useState(false)
  const [memoryOpen,setMemoryOpen]=useState(false)
  const [memorySection,setMemorySection]=useState<'instructions' | 'notes' | 'summaries'>('instructions')
  const [memoryHistory,setMemoryHistory]=useState(false)
  const [deleteProject,setDeleteProject]=useState(false)
  const [search,setSearch]=useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [occupier, setOccupier] = useState<string | null>(null)
  const [panel, setPanel] = useState<'files' | 'instructions' | 'notes' | null>(null)
  const [management, setManagement] = useState<'snapshots' | 'audit' | null>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const focusComposer = useCallback(() => {
    setPanel(null)
    window.history.replaceState(null, '', window.location.pathname)
    requestAnimationFrame(() => {composerRef.current?.scrollIntoView({block:'center'});composerRef.current?.querySelector('textarea')?.focus()})
  }, [])
  useEffect(() => {
    const navigate = () => {if(window.location.hash === '#new-conversation') focusComposer();else if(['#files','#instructions','#notes'].includes(window.location.hash)) setPanel(window.location.hash.slice(1) as 'files' | 'instructions' | 'notes')}
    const frame = requestAnimationFrame(navigate)
    const compose = (event: Event) => {if((event as CustomEvent<string>).detail === projectId) focusComposer()}
    const home = (event: Event) => {if((event as CustomEvent<string>).detail === projectId) setPanel(null)}
    window.addEventListener('rayagent:project-home',home)
    window.addEventListener('rayagent:project-compose',compose)
    window.addEventListener('hashchange',navigate)
    return () => {cancelAnimationFrame(frame);window.removeEventListener('hashchange',navigate);window.removeEventListener('rayagent:project-compose',compose);window.removeEventListener('rayagent:project-home',home)}
  },[projectId,focusComposer,loading])
  const [rename, setRename] = useState<Session | null>(null)
  const [stopping, setStopping] = useState(false)
  const [remove, setRemove] = useState<Session | null>(null)
  const request = useRef(0)
  const listRequest = useRef(0)
  const visibleCount = useRef(5)
  const scope = `project:${projectId}`
  const refresh = useCallback(async () => {
    const current = ++request.current
    try {const result = await projectApi.detail(projectId); if (current === request.current) {setProject(result); setError(null)}}
    catch (err) {if (current === request.current) setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {if (current === request.current) setLoading(false)}
  }, [projectId])
  const refreshList = useCallback(async () => {
    const current = ++listRequest.current
    try {
      const items: Session[] = []
      const limit = visibleCount.current === 5 ? 5 : 50
      let foundTotal = 0
      for (let offset = 0; offset < visibleCount.current; offset += limit) {
        const page = await projectApi.sessions(projectId, offset, limit)
        if (current !== listRequest.current) return
        foundTotal = page.total; items.push(...page.sessions)
        if (offset + limit >= page.total) break
      }
      if (current === listRequest.current) {setSessions(items); setTotal(foundTotal); setListError(null)}
    } catch (err) {if (current === listRequest.current) setListError(err instanceof Error ? err.message : '读取项目对话失败')}
  }, [projectId])
  useEffect(() => {
    void refresh(); void refreshList()
    const visible = () => {if (document.visibilityState !== 'hidden') {void refresh(); void refreshList()}}
    let hidden = document.visibilityState === 'hidden'
    const onVisibility = () => {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden === hidden) return
      hidden = nowHidden
      if (!nowHidden) visible()
    }
    let timer: number | undefined
    const unsubscribe = subscribeCatalog((hint) => {
      if (hint.kind !== 'project' || hint.id !== projectId) return
      window.clearTimeout(timer)
      timer = window.setTimeout(visible, 300)
    })
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', onVisibility)
    const detailGeneration = request
    const listGeneration = listRequest
    return () => {detailGeneration.current++; listGeneration.current++; window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', onVisibility)}
  }, [projectId, refresh, refreshList])
  const send = async (message: string, files: FileInfo[], options?: {mode?: 'normal' | 'plan'; model?: string; reasoning?: string}) => {
    if (sending || !project?.available || project.archived || project.file_operation || project.occupying_session_id) return
    setSending(true); setSendError(null); setOccupier(null)
    try {
      const id=await startProjectRecoverably(scope,projectId,{message,attachments:files.map(file=>file.id),mode:options?.mode ?? 'normal',...(options?.model && options?.reasoning ? {model:options.model,reasoning:options.reasoning} : {})})
      void registry?.refresh(); router.push(`/sessions/${id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败'
      setSendError(message)
      if (err instanceof ApiError && err.data && typeof err.data === 'object' && 'occupying_session_id' in err.data) setOccupier(String(err.data.occupying_session_id))
      setSending(false); throw err
    }
  }
  const archive = async () => {
    if (!project) return
    try {await projectApi.archive(projectId, !project.archived); await refresh(); await registry?.refresh()}
    catch (err) {toast.error(err instanceof Error ? err.message : '归档或恢复失败')}
  }
  if (loading) return <div className="p-6 text-meta text-faint">正在打开项目</div>
  if (!project) return <div className="p-6"><p role="alert" className="text-state-failed">{error ?? '项目不存在'}</p><Button variant="ghost" onClick={() => void refresh()}>重试</Button><Button variant="ghost" onClick={() => router.push('/')}>返回首页</Button></div>

  const changed = () => {void refresh(); void refreshList(); void registry?.refresh()}
  const tabs = [{value: 'conversations', label: '对话', icon: NewChatIcon}, {value: 'files', label: '文件', icon: FolderOpen}, {value: 'instructions', label: '说明', icon: FileText}, {value: 'notes', label: '笔记', icon: NotebookPen}] as const
  const selectedTab = panel === 'files' || panel === 'instructions' || panel === 'notes' ? panel : 'conversations'
  const switchTab = (next: 'conversations' | 'files' | 'instructions' | 'notes') => {
    setPanel(next === 'conversations' ? null : next)
    window.history.replaceState(null, '', next === 'conversations' ? window.location.pathname : `#${next}`)
  }
  const history = (field: 'instructions' | 'notes') => {setMemorySection(field); setMemoryHistory(true); setMemoryOpen(true)}
  return <div className="flex h-full min-w-0 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3 sm:px-8">
      <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold"><ProjectFolderIcon className="size-5 shrink-0 text-muted-foreground"/><span className="truncate" title={project.name}>{project.name}</span>{project.archived && <span className="shrink-0 text-xs font-normal text-muted-foreground">已归档</span>}</h1>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="项目操作" title="项目操作"><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setSettings(true)}>项目设置</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setManagement('snapshots')}>恢复项目文件</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setManagement('audit')}>项目操作记录</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => {setMemorySection('summaries'); setMemoryHistory(false); setMemoryOpen(true)}}>对话摘要与记忆预览</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void archive()}>{project.archived ? '取消归档' : '归档项目'}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteProject(true)}>删除项目</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-5 sm:px-8 sm:py-6">
        <SegmentedControl value={selectedTab} onValueChange={switchTab} options={tabs} label="项目页面" idPrefix="project-page" className="w-full sm:w-[360px]"/>
        {error && <p role="alert" className="text-sm text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button></p>}
        {(!project.available || project.archived) && <div className="border-l-2 border-state-waiting pl-3 text-sm"><p>{project.archived ? '项目已归档，历史内容仍可查看。' : project.reason ?? '项目目录不可用'}</p>{project.archived && <Button size="sm" variant="ghost" onClick={() => void archive()}>取消归档</Button>}</div>}
        <section hidden={!!panel} id="project-page-panel-conversations" role="tabpanel" aria-labelledby="project-page-conversations" className="space-y-7">
          <div id="new-conversation" aria-label="开始新对话" ref={composerRef} className="space-y-3">
            <h2 className="text-sm font-semibold">开始新对话</h2>
            <ProjectStateNotice showStats={false} project={project} onChanged={changed}/>
            <ChatInput draftScope={scope} selectedProject={project} onSend={send} disabled={sending || !project.available || project.archived || !!project.file_operation || !!project.occupying_session_id} placeholder="描述希望完成的任务……" commandHost={{hasSession: false, hasRuns: false, runStatus: 'idle', waitingApproval: false, waitingReply: false, submitting: sending, compacting: false, actions: {compact: () => toast.message('还没有可压缩的上下文')}}}/>
            {(sendError || project.occupying_session_id) && <p className="text-sm text-muted-foreground">{sendError ?? '此项目有正在运行或等待处理的对话。'}{(occupier || project.occupying_session_id) && <><Link className="ml-2 text-signal underline" href={`/sessions/${occupier ?? project.occupying_session_id}`}>打开占用对话</Link><Button variant="ghost" size="sm" disabled={stopping} onClick={async () => {setStopping(true);try {await sessionApi.stopSession(occupier || project.occupying_session_id!);setOccupier(null);setSendError(null);changed()} catch (error) {toast.error(error instanceof Error ? error.message : '停止失败')} finally {setStopping(false)}}}>停止运行</Button></>}</p>}
          </div>
          <section aria-labelledby="project-conversations-heading"><div className="mb-3 flex flex-wrap min-h-8 items-center justify-between gap-3"><h2 id="project-conversations-heading" className="text-sm font-semibold">项目对话</h2>{total > 5 && <div className="flex items-center gap-2">{!all && <Button size="sm" variant="ghost" onClick={() => {setAll(true); visibleCount.current=50; void refreshList()}}>查看全部（{total}）</Button>}{all && <input type="search" aria-label="搜索已加载的项目对话" placeholder="搜索已加载的对话" value={search} onChange={event => setSearch(event.target.value)} className="w-56 rounded-md border bg-card px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"/>}</div>}</div>
            {listError ? <p role="alert" className="text-sm text-state-failed">{listError}<Button variant="ghost" size="sm" onClick={() => void refreshList()}>重试</Button></p> : sessions.length ? <div className="space-y-2">{sessions.filter(session => !search || session.title.toLowerCase().includes(search.toLowerCase())).map(session => <SessionItem key={session.session_id} session={session} href={`/sessions/${session.session_id}`} isActive={false} onDelete={setRemove} onRename={setRename}/>)}{search && !sessions.some(session => session.title.toLowerCase().includes(search.toLowerCase())) && <p className="py-4 text-sm text-muted-foreground">已加载的对话中没有匹配结果。</p>}</div> : <p className="py-5 text-sm text-muted-foreground">还没有对话。从上方输入开始。</p>}
            {all && sessions.length < total && <Button variant="ghost" size="sm" className="mt-3" onClick={() => {visibleCount.current+=50; void refreshList()}}>加载更多</Button>}
          </section>
        </section>
        <div hidden={panel !== 'files'} id="project-page-panel-files" role="tabpanel" aria-labelledby="project-page-files"><ProjectFilesPage project={project} onChanged={changed}/></div>
        {(['instructions', 'notes'] as const).map(field => <div key={field} hidden={panel !== field} id={`project-page-panel-${field}`} role="tabpanel" aria-labelledby={`project-page-${field}`}><ProjectMemoryPage project={project} field={field} onSaved={changed} onHistory={() => history(field)}/></div>)}

      </div>
    </div>
    <Dialog open={!!management} onOpenChange={open => {if (!open) setManagement(null)}}><DialogContent className="flex h-[85dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"><DialogTitle className="sr-only">{management === 'audit' ? '项目操作记录' : '恢复项目文件'}</DialogTitle><DialogDescription className="sr-only">{project.name}</DialogDescription><div className="min-h-0 flex-1 overflow-y-auto">{management && <ManagedProjectPane projectId={projectId} section={management} conversationTitles={Object.fromEntries(sessions.map(session => [session.session_id, session.title]))}/>}</div></DialogContent></Dialog>
    <ProjectMemoryPanel projectId={projectId} open={memoryOpen} initialSection={memorySection} initialOverlay={memoryHistory ? 'history' : null} onClose={() => setMemoryOpen(false)} onChanged={changed}/>
    <ProjectSettingsDialog id={settings ? projectId : null} onClose={() => setSettings(false)} onSaved={changed}/>
    <DataCleanupDialog open={deleteProject} projectId={projectId} onClose={() => setDeleteProject(false)} onCompleted={() => {void registry?.refresh(); router.replace('/')}}/>
    {rename && <RenameSessionDialog open sessionId={rename.session_id} currentTitle={rename.title} onOpenChange={open => {if (!open) setRename(null)}} onSaved={changed}/>}
    <DeleteSessionDialog open={!!remove} onOpenChange={open => {if (!open) setRemove(null)}} onConfirm={async () => {if (remove) {try {await sessionApi.deleteSession(remove.session_id); setRemove(null); changed()} catch (err) {toast.error(err instanceof Error ? err.message : '删除失败')}}}}/>
  </div>
}
