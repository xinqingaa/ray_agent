'use client'

import {useEffect, useRef, useState} from 'react'
import {useRouter, usePathname} from 'next/navigation'
import Link from 'next/link'
import {toast} from 'sonner'
import {Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {Folder, Plus, Settings} from 'lucide-react'
import {SidebarChrome} from '@/components/sidebar-chrome'
import {ProjectNavigation, type NavigationExpansion, type NavigationProject} from '@/components/project-navigation'
import {ProjectSettingsDialog} from '@/components/project-settings-dialog'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {useProjects} from '@/providers/projects-provider'
import {useSessions} from '@/hooks/use-sessions'
import {projectApi} from '@/lib/api/project'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api/types'

const DEFAULT_EXPANSION: NavigationExpansion = {projects: true, conversations: true, items: {}}
export function LeftPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile} = useSidebar()
  const workspace = useProjects()!
  const {sessions, refresh, deleteSession, patchSession} = useSessions()
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION)
  const [restored, setRestored] = useState(false)
  const [rows, setRows] = useState<NavigationProject[]>([])
  const [selectedRecord, setSelected] = useState<Session | null>(null)
  const [settings, setSettings] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [pendingRename, setPendingRename] = useState<Session | null>(null)
  const sessionId = pathname.startsWith('/sessions/') ? pathname.split('/')[2] : null
  const selected = selectedRecord?.session_id === sessionId ? selectedRecord : null
  const projectId = pathname.startsWith('/projects/') ? pathname.split('/')[2] : selected?.project?.id ?? null
  const located = useRef<string | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {const saved = JSON.parse(localStorage.getItem('rayagent:navigation') ?? 'null'); if (saved && typeof saved.projects === 'boolean' && typeof saved.conversations === 'boolean' && saved.items && typeof saved.items === 'object') setExpansion(saved)} catch {}
      setRestored(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const expand = (state: NavigationExpansion) => {setExpansion(state); localStorage.setItem('rayagent:navigation', JSON.stringify(state))}
  useEffect(() => {
    if (!sessionId) {located.current = null; return}
    let active = true
    sessionApi.getSession(sessionId).then(session => {
      if (!active) return
      setSelected(session)
      if (restored && located.current !== sessionId) {
        located.current = sessionId
        setExpansion(old => {
          const id = session.project?.id
          const next = id ? {...old, projects: true, items: {...old.items, [id]: true}} : {...old, conversations: true}
          localStorage.setItem('rayagent:navigation', JSON.stringify(next)); return next
        })
      }
    }).catch(() => {if (active) setSelected(null)})
    return () => {active = false}
  }, [sessionId, restored])
  useEffect(() => {
    let active = true
    const load = async () => {
      const next = await Promise.all(workspace.projects.map(async project => {
        if (!expansion.projects || !expansion.items[project.id]) return {...project, conversations: []}
        try {
          const page = await projectApi.sessions(project.id, 0, 5)
          const list = page.sessions
          if (selected?.project?.id === project.id && !list.some(s => s.session_id === selected.session_id)) list.push(selected)
          return {...project, conversations: list}
        } catch (err) {return {...project, conversations: [], navigationError: err instanceof Error ? err.message : '读取对话失败'}}
      }))
      if (active) setRows(next)
    }
    void load()
    return () => {active = false}
  }, [workspace.projects, expansion, selected, sessions])
  const independent = () => {setOpenMobile(false); router.push('/')}
  const remove = async () => {
    if (!pendingDelete) return
    const success = await deleteSession(pendingDelete.session_id)
    if (success) {if (sessionId === pendingDelete.session_id) router.push(pendingDelete.project ? `/projects/${pendingDelete.project.id}` : '/'); await workspace.refresh(); await refresh()}
    else toast.error('删除对话失败，请重试')
    setPendingDelete(null)
  }
  const archive = async (id: string) => {
    try {await projectApi.archive(id, true); await workspace.refresh(); if (projectId === id && !sessionId) router.push('/')}
    catch (err) {toast.error(err instanceof Error ? err.message : '归档失败')}
  }
  const conversations = [...sessions]
  if (selected && !selected.project && !conversations.some(item => item.session_id === selected.session_id)) conversations.push(selected)
  return <>
    <Sidebar collapsible="icon">
      <SidebarHeader><SidebarChrome/></SidebarHeader>
      <SidebarContent className="min-h-0 overflow-hidden p-2">
        <div className="hidden flex-1 flex-col items-center gap-2 group-data-[collapsible=icon]:flex">
          <Button variant="ghost" size="icon" aria-label="打开项目" title="打开项目" onClick={workspace.openProject}><Folder/></Button>
          <Button variant="ghost" size="icon" aria-label="新独立对话" title="新独立对话" onClick={independent}><Plus/></Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
          <ProjectNavigation projects={rows} conversations={conversations} expansion={expansion} onExpansion={expand} selectedProject={projectId} selectedSession={sessionId}
            loading={workspace.loading} error={workspace.error} onRetry={() => void workspace.refresh()} onOpenProject={workspace.openProject} onIndependent={independent}
            onProjectSettings={setSettings} onArchive={id => void archive(id)} onSessionDelete={setPendingDelete} onSessionRename={setPendingRename} onNavigate={() => setOpenMobile(false)}/>
          {workspace.projects.length < workspace.total && <Button size="sm" variant="ghost" onClick={() => void workspace.more()}>更多项目</Button>}
        </div>
      </SidebarContent>
      <SidebarFooter><Button variant="ghost" asChild className="w-full justify-start gap-2.5 text-muted-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"><Link href="/settings" onClick={() => setOpenMobile(false)} title="设置" aria-label="设置"><Settings className="size-4"/><span className="group-data-[collapsible=icon]:hidden">设置</span></Link></Button></SidebarFooter>
    </Sidebar>
    <ProjectSettingsDialog id={settings} onClose={() => setSettings(null)} onSaved={() => void workspace.refresh()}/>
    <DeleteSessionDialog open={!!pendingDelete} onOpenChange={open => {if (!open) setPendingDelete(null)}} onConfirm={remove}/>
    {pendingRename && <RenameSessionDialog sessionId={pendingRename.session_id} currentTitle={pendingRename.title} open onOpenChange={open => {if (!open) setPendingRename(null)}} onSaved={title => {patchSession(pendingRename.session_id, {title}); void refresh(); void workspace.refresh()}}/>}
  </>
}
