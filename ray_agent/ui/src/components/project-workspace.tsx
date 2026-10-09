'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {ArrowLeft, MoreHorizontal, Settings, X} from 'lucide-react'
import {ProjectFolderIcon} from '@/components/nav-icons'
import {ProjectPane} from '@/components/workbench/project-pane'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'
import {projectWriteReason} from '@/components/project-state-notice'
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
  const [memorySection,setMemorySection]=useState<'instructions' | 'notes'>('instructions')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [occupier, setOccupier] = useState<string | null>(null)
  const [panel, setPanel] = useState<'files' | 'snapshots' | 'audit' | null>(null)
  const [upload, setUpload] = useState(false)
  const composerRef = useRef<HTMLDivElement>(null)
  const focusComposer = useCallback(() => {
    setPanel(null)
    requestAnimationFrame(() => {composerRef.current?.scrollIntoView({block:'center'});composerRef.current?.querySelector('textarea')?.focus()})
  }, [])
  useEffect(() => {
    const navigate = () => {if(window.location.hash === '#new-conversation') focusComposer();else if(window.location.hash === '#files') setPanel('files')}
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

  return <div className="flex h-full min-w-0">
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1"><h1 className="flex min-w-0 items-center gap-1.5 text-base font-semibold"><ProjectFolderIcon className="size-5 shrink-0 text-muted-foreground"/><span className="truncate" title={project.name}>{project.name}</span></h1></div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="项目管理"><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={()=>setPanel('files')}>管理项目文件与导出</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>setPanel('snapshots')}>恢复项目文件</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>setPanel('audit')}>项目操作记录</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>void archive()}>{project.archived ? '恢复已归档项目' : '归档项目'}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        <Button size="icon-sm" variant="ghost" title="项目设置" aria-label="项目设置" onClick={() => setSettings(true)}><Settings/></Button>
        <Button size="icon-sm" variant="ghost" title="关闭项目" aria-label="关闭项目" onClick={() => router.push('/')}><X/></Button>
      </header>
      {panel && <div className="flex min-h-0 flex-1 flex-col"><Button variant="ghost" className="m-3 self-start" onClick={()=>setPanel(null)}><ArrowLeft className="size-4"/>返回项目主页</Button><ManagedProjectPane key={`${projectId}:${panel}`} projectId={projectId} section={panel} conversationTitles={Object.fromEntries(sessions.map(session=>[session.session_id,session.title]))}/></div>}<div hidden={!!panel} className={panel ? "hidden" : "min-h-0 flex-1 overflow-y-auto"}><div className="mx-auto w-full max-w-(--reading-column) space-y-6 px-5 py-6 sm:px-8 sm:py-8">
        {error && <p role="alert" className="text-meta text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button></p>}
        {(!project.available || project.archived) && <div className="border-l-2 border-state-waiting pl-3 text-meta"><p>{project.archived ? '项目已归档，历史对话仍可查看。' : project.reason ?? '项目目录不可用'}</p><Button size="sm" variant="ghost" onClick={() => void archive()}>{project.archived ? '恢复项目' : '归档项目'}</Button>{!project.available && <Button size="sm" variant="ghost" onClick={registry?.openProject}>打开其他项目</Button>}</div>}
        <ProjectStateNotice showStats={false} project={project} onChanged={() => {void refresh(); void registry?.refresh()}}/>
        <section id="new-conversation" aria-label="开始新对话" ref={composerRef}><ChatInput draftScope={scope} selectedProject={project} onSend={send} disabled={sending || !project.available || project.archived || !!project.file_operation || !!project.occupying_session_id} placeholder="描述这次希望完成的任务……" commandHost={{hasSession: false, hasRuns: false, runStatus: 'idle', waitingApproval: false, waitingReply: false, submitting: sending, compacting: false, actions: {compact: () => toast.message('还没有可压缩的上下文')}}}/></section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-10">
          <section className="min-w-0" aria-labelledby="project-conversations-heading">
            <div className="mb-4 flex min-h-8 items-center justify-between gap-2"><h2 id="project-conversations-heading" className="text-sm font-semibold">{all ? '项目对话' : '最近对话'}</h2>{!all && total > 5 && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => {setAll(true); visibleCount.current = 50; void refreshList()}}>查看全部（{total}）</Button>}</div>
            {listError ? <p role="alert" className="text-meta text-state-failed">{listError}<Button variant="ghost" size="sm" onClick={() => void refreshList()}>重试</Button></p> : sessions.length ? <div className="space-y-2">{sessions.map(session => <div key={session.session_id} className="py-1"><SessionItem session={session} href={`/sessions/${session.session_id}`} isActive={false} onDelete={setRemove} onRename={setRename}/></div>)}</div> : <p className="py-6 text-sm text-muted-foreground">还没有对话。从上方输入任务开始。</p>}
            {all && sessions.length < total && <Button variant="ghost" size="sm" className="mt-3" onClick={() => {visibleCount.current += 50; void refreshList()}}>加载更多</Button>}
          </section>
          <aside aria-label="项目资料" className="min-w-0 space-y-6 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <section aria-labelledby="project-files-heading"><div className="mb-3 flex min-h-8 items-center justify-between gap-2"><h2 id="project-files-heading" className="text-sm font-semibold">项目文件</h2><Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!!projectWriteReason(project)} title={projectWriteReason(project) || '添加供本项目后续任务使用的材料'} onClick={()=>setUpload(true)}>添加</Button></div><ProjectPane key={projectId} sessionId={projectId} projectLevel downloadProjectId={projectId} overview refreshSignal={project.updated_at ? Date.parse(project.updated_at) : 0}/><Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" onClick={()=>setPanel('files')}>查看全部文件</Button></section>
            <section className="border-t pt-4"><div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">项目说明</h2><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={()=>{setMemorySection('instructions');setMemoryOpen(true)}}>编辑</Button></div><p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{project.instructions || '尚未设置长期要求'}</p></section>
            <section className="border-t pt-4"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">项目笔记</h2><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={()=>{setMemorySection('notes');setMemoryOpen(true)}}>查看</Button></div><p className="mt-1 text-sm text-muted-foreground">{project.notes?.trim() ? '已有笔记' : '尚无笔记'}</p></section>
          </aside>
        </div>

        {(sendError || project.occupying_session_id) && <p className="text-meta text-muted-foreground">{sendError ?? '此项目有正在运行或等待处理的对话。'}{(occupier || project.occupying_session_id) && <Link className="ml-2 text-signal underline" href={`/sessions/${occupier ?? project.occupying_session_id}`}>返回占用对话</Link>}{(occupier || project.occupying_session_id) && <Button variant="ghost" size="sm" disabled={stopping} onClick={async () => {setStopping(true);try{await sessionApi.stopSession(occupier || project.occupying_session_id!);setOccupier(null);setSendError(null);await refresh();await registry?.refresh()}catch(error){toast.error(error instanceof Error ? error.message : '停止失败')}finally{setStopping(false)}}}>停止占用运行</Button>}</p>}

      </div></div>
    </main>
    <ProjectUploadDialog open={upload} projectId={projectId} disabledReason={projectWriteReason(project)} onClose={()=>setUpload(false)} onUploaded={()=>{void refresh();void registry?.refresh()}}/>
    <ProjectMemoryPanel projectId={projectId} open={memoryOpen} initialSection={memorySection} onClose={()=>setMemoryOpen(false)} onChanged={()=>{void refresh();void refreshList();void registry?.refresh()}}/>
    <ProjectSettingsDialog id={settings ? projectId : null} onClose={() => setSettings(false)} onSaved={() => {void refresh(); void registry?.refresh()}}/>
    {rename && <RenameSessionDialog open sessionId={rename.session_id} currentTitle={rename.title} onOpenChange={open => {if (!open) setRename(null)}} onSaved={() => {void refreshList(); void registry?.refresh()}}/>}
    <DeleteSessionDialog open={!!remove} onOpenChange={open => {if (!open) setRemove(null)}} onConfirm={async () => {if (remove) {try {await sessionApi.deleteSession(remove.session_id); setRemove(null); await refreshList(); await registry?.refresh()} catch (err) {toast.error(err instanceof Error ? err.message : '删除失败')}}}}/>
  </div>
}
