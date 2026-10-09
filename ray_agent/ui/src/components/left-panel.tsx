'use client'

import {useEffect, useRef, useState} from 'react'
import {useRouter, usePathname} from 'next/navigation'
import {toast} from 'sonner'
import {Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Settings} from 'lucide-react'
import {ImportFolderIcon, NewChatIcon, NewProjectIcon} from '@/components/nav-icons'
import {SettingsDialog} from '@/components/settings/settings-dialog'
import {SidebarChrome} from '@/components/sidebar-chrome'
import {NavigationCreateButton, ProjectNavigation, type NavigationExpansion, type NavigationProject} from '@/components/project-navigation'
import {ProjectSettingsDialog} from '@/components/project-settings-dialog'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {useProjects} from '@/providers/projects-provider'
import {useSessions} from '@/hooks/use-sessions'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import {sessionApi} from '@/lib/api/session'
import type {ProjectView, Session} from '@/lib/api/types'

const DEFAULT_EXPANSION: NavigationExpansion = {projects: true, conversations: true, items: {}}
export function LeftPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const {setOpenMobile, setOpen} = useSidebar()
  const workspace = useProjects()!
  const {sessions, refresh, deleteSession, patchSession, liveSession} = useSessions()
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION)
  const [restored, setRestored] = useState(false)
  const [rows, setRows] = useState<NavigationProject[]>([])
  const [selectedRecord, setSelected] = useState<Session | null>(null)
  const [locatedProject, setLocatedProject] = useState<ProjectView | null>(null)
  const [settings, setSettings] = useState<string | null>(null)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [pendingRename, setPendingRename] = useState<Session | null>(null)
  const sessionId = pathname.startsWith('/sessions/') ? pathname.split('/')[2] : null
  const selected = selectedRecord?.session_id === sessionId ? selectedRecord : null
  const projectId = pathname.startsWith('/projects/') ? pathname.split('/')[2] : selected?.project?.id ?? null
  const previousRoute = useRef<string | null>(null)
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = subscribeCatalog((hint) => {
      if (hint.kind !== 'project' && hint.kind !== 'session') return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPulse((value) => value + 1), 300)
    })
    return () => {unsubscribe(); window.clearTimeout(timer)}
  }, [])
  useEffect(() => {
    if (sessionId && !selected) return
    if (previousRoute.current === pathname) return
    previousRoute.current = pathname
    workspace.setNavigationTab?.(projectId ? 'projects' : 'conversations')
  }, [pathname, sessionId, selected, projectId, workspace])
  const navigationRequest = workspace.navigationRequest
  useEffect(() => {if (navigationRequest) setOpen?.(true)}, [navigationRequest, setOpen])
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
    if (!projectId || workspace.projects.some(project => project.id === projectId) || selected?.project?.id === projectId) return
    let active = true
    projectApi.detail(projectId).then(project => {if (active) setLocatedProject(project)})
      .catch(() => {if (active) setLocatedProject(null)})
    return () => {active = false}
  }, [projectId, workspace.projects, selected?.project?.id])
  useEffect(() => {
    let active = true
    const load = async () => {
      const projects = [...workspace.projects]
      const current = selected?.project ?? (locatedProject?.id === projectId ? locatedProject : null)
      if (current && !projects.some(project => project.id === current.id)) projects.unshift(current)
      const next = await Promise.all(projects.map(async project => {
        if (!expansion.projects || !expansion.items[project.id]) return {...project, taskCount: project.task_count, conversations: [], navigationError: undefined}
        try {
          const page = await projectApi.sessions(project.id, 0, 5)
          const list = page.sessions
          if (selected?.project?.id === project.id && !list.some(s => s.session_id === selected.session_id)) list.push(selected)
          return {...project, taskCount: project.task_count, conversations: list, navigationError: undefined}
        } catch (err) {return {...project, taskCount: project.task_count, conversations: selected?.project?.id === project.id ? [selected] : [], navigationError: err instanceof Error ? err.message : '读取对话失败'}}
      }))
      if (active) {
        setRows(next)

      }
    }
    void load()
    return () => {active = false}
  }, [workspace.projects, expansion, selected, locatedProject, projectId, pulse])
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
  const projectRows = rows.map(project => ({
    ...project,
    conversations: project.conversations.map(item => liveSession && item.session_id === sessionId && item.session_id === liveSession.id && item.status !== liveSession.status ? {...item, status: liveSession.status} : item),
  }))
  return <>
    <Sidebar collapsible="icon">
      <SidebarHeader><SidebarChrome action={<NavigationCreateButton tab={workspace.navigationTab} onIndependent={independent} onCreateProject={workspace.createProject} onImportProject={workspace.importProject}/>}/></SidebarHeader>
      <SidebarContent className="min-h-0 overflow-hidden p-2">
        <div className="hidden flex-1 flex-col items-center gap-2 group-data-[collapsible=icon]:flex">
          <Button variant="ghost" size="icon-sm" className="group/create text-muted-foreground" aria-label="新对话" title="新对话" onClick={independent}><NewChatIcon className="size-[18px]" aria-hidden="true"/></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="group/create text-muted-foreground" aria-label="新建项目" title="新建项目"><NewProjectIcon className="size-[18px]" aria-hidden="true"/></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              <DropdownMenuItem onSelect={workspace.createProject}><NewProjectIcon aria-hidden="true"/>空白项目</DropdownMenuItem>
              <DropdownMenuItem onSelect={workspace.importProject}><ImportFolderIcon aria-hidden="true"/>从文件夹创建</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
          <ProjectNavigation projects={projectRows} conversations={conversations} expansion={expansion} onExpansion={expand} selectedProject={projectId} selectedSession={sessionId}
            tab={workspace.navigationTab} onTabChange={workspace.setNavigationTab} onOpenArchived={workspace.openArchived} onMoreProjects={workspace.projects.length < workspace.total ? () => void workspace.more() : undefined}
            loading={workspace.loading} error={workspace.error} onRetry={() => void workspace.refresh()} onOpenProject={workspace.openProject}
            onProjectSettings={setSettings} onArchive={id => void archive(id)} onSessionDelete={setPendingDelete} onSessionRename={setPendingRename} onNavigate={() => setOpenMobile(false)}/>
        </div>
      </SidebarContent>
      <SidebarFooter><Button variant="ghost" className="w-full justify-start gap-2.5 text-muted-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:self-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0" onClick={() => {setOpenMobile(false); setAppSettingsOpen(true)}} title="设置" aria-label="设置"><Settings className="size-[18px]" aria-hidden="true"/><span className="group-data-[collapsible=icon]:hidden">设置</span></Button></SidebarFooter>
    </Sidebar>
    <SettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen}/>
    <ProjectSettingsDialog id={settings} onClose={() => setSettings(null)} onSaved={() => void workspace.refresh()}/>
    <DeleteSessionDialog open={!!pendingDelete} onOpenChange={open => {if (!open) setPendingDelete(null)}} onConfirm={remove}/>
    {pendingRename && <RenameSessionDialog sessionId={pendingRename.session_id} currentTitle={pendingRename.title} open onOpenChange={open => {if (!open) setPendingRename(null)}} onSaved={title => {
      const id = pendingRename.session_id
      patchSession(id, {title})
      setRows(current => current.map(project => ({...project, conversations: project.conversations.map(item => item.session_id === id ? {...item, title} : item)})))
      setSelected(current => current?.session_id === id ? {...current, title} : current)
      void refresh(); void workspace.refresh()
    }}/>}
  </>
}
