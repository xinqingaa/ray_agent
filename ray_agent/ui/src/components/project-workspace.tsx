'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {Files, PanelRightClose, Settings, X} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {ChatInput} from '@/components/chat-input'
import {ProjectSettingsDialog} from '@/components/project-settings-dialog'
import {ProjectPane} from '@/components/workbench/project-pane'
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet'
import {useIsMobile} from '@/hooks/use-mobile'
import {useProjects} from '@/providers/projects-provider'
import {projectApi} from '@/lib/api/project'
import {sessionApi} from '@/lib/api/session'
import {ApiError} from '@/lib/api/fetch'
import type {FileInfo, ProjectDetails, Session} from '@/lib/api/types'
import {readDraft, writeDraft} from '@/lib/drafts'
import {sendRecoverably} from '@/lib/send-recovery'
import {SessionItem} from '@/components/session-item'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'

export function ProjectWorkspace({projectId}: {projectId: string}) {
  const router = useRouter()
  const registry = useProjects()
  const mobile = useIsMobile()
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [total, setTotal] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [settings, setSettings] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [occupier, setOccupier] = useState<string | null>(null)
  const [panel, setPanel] = useState<'project' | null>(null)
  const [rename, setRename] = useState<Session | null>(null)
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
    const timer = setInterval(visible, 5000)
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => {request.current++; listRequest.current++; clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible)}
  }, [projectId, refresh, refreshList])
  const send = async (message: string, files: FileInfo[], options?: {mode?: 'normal' | 'plan'}) => {
    if (sending || !project?.available || project.archived) return
    setSending(true); setSendError(null); setOccupier(null)
    try {
      let id = readDraft(scope).sessionId
      if (!id) {id = (await sessionApi.createSession({project_id: projectId})).session_id; writeDraft(scope, {sessionId: id})}
      await sendRecoverably(scope, id, {message, attachments: files.map(file => file.id), mode: options?.mode ?? 'normal'})
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
  const contents = <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-2 border-b p-2"><span className="px-2 text-sm font-medium">项目文件</span><Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="关闭工作台" onClick={() => setPanel(null)}><PanelRightClose/></Button></div>
    <ProjectPane key={projectId} sessionId={projectId} projectLevel/>
  </div>
  return <div className="flex h-full min-w-0">
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-medium">{project.name}</h1><p className="text-xs text-faint">平台托管文件</p></div>
        <Button size="icon-sm" variant="ghost" title="项目文件" aria-label="项目文件" disabled={!project.available} onClick={() => setPanel('project')}><Files/></Button>
        <Button size="icon-sm" variant="ghost" title="项目设置" aria-label="项目设置" onClick={() => setSettings(true)}><Settings/></Button>
        <Button size="icon-sm" variant="ghost" title="关闭项目" aria-label="关闭项目" onClick={() => router.push('/')}><X/></Button>
      </header>
      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
        {error && <p role="alert" className="text-meta text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button></p>}
        {(!project.available || project.archived) && <div className="border-l-2 border-state-waiting pl-3 text-meta"><p>{project.archived ? '项目已归档，历史对话仍可查看。' : project.reason ?? '项目目录不可用'}</p><Button size="sm" variant="ghost" onClick={() => void archive()}>{project.archived ? '恢复项目' : '归档项目'}</Button>{!project.available && <Button size="sm" variant="ghost" onClick={registry?.openProject}>重新添加目录</Button>}</div>}
        <div><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-medium text-muted-foreground">{all ? '项目对话' : '最近对话'}</h2>{!all && total > 5 && <Button size="sm" variant="ghost" onClick={() => {setAll(true); visibleCount.current = 50; void refreshList()}}>查看全部（{total}）</Button>}</div>
          {listError ? <p role="alert" className="text-meta text-state-failed">{listError}<Button variant="ghost" size="sm" onClick={() => void refreshList()}>重试</Button></p> : sessions.map(session => <SessionItem key={session.session_id} session={session} href={`/sessions/${session.session_id}`} isActive={false} onDelete={setRemove} onRename={setRename}/>)}
          {!listError && sessions.length === 0 && <p className="py-3 text-meta text-faint">还没有对话，在下方描述目标即可开始。</p>}
          {all && sessions.length < total && <Button variant="ghost" size="sm" onClick={() => {visibleCount.current += 50; void refreshList()}}>加载更多</Button>}
        </div>
        <ChatInput draftScope={scope} selectedProject={project} onSend={send} disabled={sending || !project.available || project.archived} placeholder={`在 ${project.name} 中开始新对话`} commandHost={{hasSession: false, hasRuns: false, runStatus: 'idle', waitingApproval: false, waitingReply: false, submitting: sending, compacting: false, actions: {compact: () => toast.message('还没有可压缩的上下文')}}}/>
        {(sendError || project.occupying_session_id) && <p className="text-meta text-muted-foreground">{sendError ?? '此项目有正在运行或等待处理的对话。'}{(occupier || project.occupying_session_id) && <Link className="ml-2 text-signal underline" href={`/sessions/${occupier ?? project.occupying_session_id}`}>返回占用对话</Link>}</p>}
      </div>
    </main>
    {panel && !mobile && <aside className="flex w-[42%] min-w-[320px] max-w-[600px] flex-col border-l">{contents}</aside>}
    {mobile && <Sheet open={!!panel} onOpenChange={open => {if (!open) setPanel(null)}}><SheetContent side="right" className="w-[95vw] gap-0 p-0 [&>button]:hidden"><SheetTitle className="sr-only">项目工作台</SheetTitle>{contents}</SheetContent></Sheet>}
    <ProjectSettingsDialog id={settings ? projectId : null} onClose={() => setSettings(false)} onSaved={() => {void refresh(); void registry?.refresh()}}/>
    {rename && <RenameSessionDialog open sessionId={rename.session_id} currentTitle={rename.title} onOpenChange={open => {if (!open) setRename(null)}} onSaved={() => {void refreshList(); void registry?.refresh()}}/>}
    <DeleteSessionDialog open={!!remove} onOpenChange={open => {if (!open) setRemove(null)}} onConfirm={async () => {if (remove) {try {await sessionApi.deleteSession(remove.session_id); setRemove(null); await refreshList(); await registry?.refresh()} catch (err) {toast.error(err instanceof Error ? err.message : '删除失败')}}}}/>
  </div>
}
