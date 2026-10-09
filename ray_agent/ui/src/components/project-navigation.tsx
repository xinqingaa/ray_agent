'use client'

import {useRef, useState, type MouseEvent} from 'react'
import Link from 'next/link'
import {ChevronDown, ChevronUp, MoreHorizontal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {RunStatus} from '@/components/run/run-status'
import {SessionItem} from '@/components/session-item'
import {ImportFolderIcon, NewChatIcon, NewProjectIcon, ProjectFolderIcon} from '@/components/nav-icons'
import type {Session} from '@/lib/api/types'
import {cn} from '@/lib/utils'

export type NavigationProject = {
  id: string
  name: string
  available: boolean
  archived?: boolean
  reason?: string | null
  active_run_status?: string | null
  active_run_reason?: string | null
  occupying_session_id?: string | null
  file_operation?: import("@/lib/api/types").ProjectFileOperation | null
  conversations: Session[]
  /** 项目里的对话数。0 表示点项目行不展开。 */
  taskCount?: number
  navigationError?: string
}
export type NavigationExpansion = {projects: boolean; conversations: boolean; items: Record<string, boolean>}

type Props = {
  projects: NavigationProject[]
  conversations: Session[]
  expansion: NavigationExpansion
  onExpansion: (state: NavigationExpansion) => void
  selectedProject?: string | null
  selectedSession?: string | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onOpenProject: () => void
  tab?: 'conversations' | 'projects'
  onTabChange?: (tab: 'conversations' | 'projects') => void
  onOpenArchived?: () => void
  onMoreProjects?: () => void
  onProjectSettings: (id: string) => void
  onArchive: (id: string) => void
  onSessionDelete: (session: Session) => void
  onSessionRename: (session: Session) => void
  onNavigate?: (path: string) => void
  onNewConversation?: (projectId: string) => void
  /** 目录示例保留导航交互，但不访问产品路由。 */
  preview?: boolean
}

const createButtonClass = 'group/create size-8 text-muted-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent'

/** 侧栏顶部的新建图标。对话标签打开首页草稿，项目标签选择空白项目或从文件夹创建。 */
export function NavigationCreateButton({tab, onIndependent, onCreateProject, onImportProject, onOpenProject}: {
  tab: 'conversations' | 'projects'
  onIndependent: () => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onOpenProject?: () => void
}) {
  if (tab === 'conversations') {
    return (
      <Button variant="ghost" size="icon-sm" className={createButtonClass} aria-label="新对话" title="新对话" onClick={onIndependent}>
        <NewChatIcon className="size-[18px]" aria-hidden="true"/>
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={createButtonClass} aria-label="新建项目" title="新建项目">
          <NewProjectIcon className="size-[18px]" aria-hidden="true"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onCreateProject ?? onOpenProject}><NewProjectIcon aria-hidden="true"/>空白项目</DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportProject ?? onOpenProject}><ImportFolderIcon aria-hidden="true"/>从文件夹创建</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 左侧仅管理归属导航；展开状态由调用方持有，不随列表刷新重置。 */
export function ProjectNavigation(props: Props) {
  const {projects, conversations, expansion, onExpansion, selectedSession, preview} = props
  const [localTab, setLocalTab] = useState<'conversations' | 'projects'>(props.selectedProject ? 'projects' : 'conversations')
  const tab = props.tab ?? localTab
  const scroll = useRef<HTMLDivElement>(null)
  const positions = useRef({projects: 0, conversations: 0})
  const switchTab = (next: 'conversations' | 'projects') => {
    if (scroll.current) positions.current[tab] = scroll.current.scrollTop
    setLocalTab(next); props.onTabChange?.(next)
    requestAnimationFrame(() => {if (scroll.current) scroll.current.scrollTop = positions.current[next]})
  }
  const sessionRow = (session: Session, waitKind?: 'reply' | 'approval') => <SessionItem key={session.session_id} session={session} isActive={selectedSession === session.session_id}
    href={preview ? undefined : `/sessions/${session.session_id}`}
    onClick={() => props.onNavigate?.(`/sessions/${session.session_id}`)}
    onDelete={props.onSessionDelete} onRename={props.onSessionRename} waitKind={waitKind}/>
  return (
    <nav aria-label="项目与对话" className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="导航模式" className="mb-3 flex min-h-8 shrink-0 rounded-full bg-muted p-0.5">
        {(['conversations', 'projects'] as const).map(value => <button key={value} type="button" role="tab" id={`nav-${value}`} aria-controls="navigation-list" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          onClick={() => switchTab(value)} onKeyDown={event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault(); const next = event.key === 'Home' ? 'conversations' : event.key === 'End' ? 'projects' : tab === 'projects' ? 'conversations' : 'projects'; switchTab(next); document.getElementById(`nav-${next}`)?.focus()}}}
          className={cn('flex-1 rounded-full text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === value ? 'bg-card font-medium text-foreground shadow-sm' : 'font-normal text-muted-foreground')}>{value === 'conversations' ? '对话' : '项目'}</button>)}
      </div>
      <div ref={scroll} id="navigation-list" role="tabpanel" aria-labelledby={`nav-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div hidden={tab !== 'projects'} className="flex flex-col gap-1">
          {props.loading && <p className="px-2 py-3 text-meta text-faint">正在读取项目</p>}
          {props.error && <div className="px-2 py-3"><p role="alert" className="text-meta text-state-failed">{props.error}</p><Button size="sm" variant="ghost" onClick={props.onRetry}>重试</Button></div>}
          {projects.map(project => {
            const selected = props.selectedProject === project.id
            const open = !!expansion.items[project.id]
            const toggleProject = () => {
              onExpansion({...expansion, items: {...expansion.items, [project.id]: !open}})
            }
            const openProject = (event: MouseEvent) => {
              if (preview) event.preventDefault()
              if (!preview) window.dispatchEvent(new CustomEvent('rayagent:project-home', {detail:project.id}))
              props.onNavigate?.(`/projects/${project.id}`)
            }
            const prepareConversation = (event: MouseEvent) => {
              openProject(event)
              if (!preview) window.dispatchEvent(new CustomEvent('rayagent:project-compose', {detail:project.id}))
            }
            const startConversation = () => {
              if (!expansion.items[project.id]) onExpansion({...expansion, items: {...expansion.items, [project.id]: true}})
              props.onNavigate?.(`/sessions/new`)
              props.onNewConversation?.(project.id)
            }
            return <div key={project.id}>
              <div className="group/project relative flex min-h-8 items-center">
                <Link href={`/projects/${project.id}`} aria-current={selected && !selectedSession ? 'page' : undefined} onClick={openProject} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ProjectFolderIcon className={cn('size-4 shrink-0', selected ? 'text-foreground' : 'text-muted-foreground')}/>
                  <RunStatus
                    place="project"
                    name={project.name}
                    available={project.available}
                    reason={project.reason}
                    activeRunStatus={project.active_run_status}
                    activeRunReason={project.active_run_reason}
                    fileOperation={project.file_operation}
                    archived={project.archived}
                  />
                </Link>
                <div className="relative flex shrink-0 items-center pr-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={`${project.name} 的操作`} className="absolute right-full z-10 mr-0.5 text-muted-foreground opacity-0 pointer-events-none hover:bg-muted group-hover/project:pointer-events-auto group-hover/project:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 max-md:pointer-events-auto max-md:opacity-100">
                        <MoreHorizontal className="size-3.5"/>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {project.archived || !props.onNewConversation
                        ? <DropdownMenuItem asChild><Link href={`/projects/${project.id}${project.archived ? '' : '#new-conversation'}`} onClick={project.archived ? openProject : prepareConversation}>{project.archived ? '打开项目' : '在此项目新对话'}</Link></DropdownMenuItem>
                        : <DropdownMenuItem onSelect={startConversation}>在此项目新对话</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => props.onProjectSettings(project.id)}>项目设置</DropdownMenuItem>
                      {!project.archived && <DropdownMenuItem onSelect={() => props.onArchive(project.id)}>归档项目</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {!project.archived && (props.onNewConversation ? (
                    <button type="button" aria-label={`${project.name} 中新对话`} title="在此项目中新对话" onClick={startConversation} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <NewChatIcon className="size-4"/>
                    </button>
                  ) : (
                    <Link href={`/projects/${project.id}#new-conversation`} aria-label={`${project.name} 中新对话`} title="在此项目中新对话" onClick={prepareConversation} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <NewChatIcon className="size-4"/>
                    </Link>
                  ))}
                  <button type="button" aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${project.name} 的对话`} onClick={toggleProject} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {open ? <ChevronUp className="size-4"/> : <ChevronDown className="size-4"/>}
                  </button>
                </div>
              </div>
              {open && <div className="ml-6 flex flex-col gap-2 py-1">
                {!project.conversations.length && !project.navigationError && <p className="px-2 py-2 text-xs text-faint">还没有对话</p>}
                {project.conversations.map(session => sessionRow(session, project.active_run_status === 'waiting' && project.occupying_session_id === session.session_id ? project.active_run_reason === 'approval' ? 'approval' : 'reply' : undefined))}
                {project.navigationError && <p role="alert" className="px-2 py-1 text-xs text-state-failed">{project.navigationError}</p>}
              </div>}
            </div>})}
          {props.onMoreProjects && <Button size="sm" variant="ghost" className="mt-1" onClick={props.onMoreProjects}>更多项目</Button>}
        </div>
        <div hidden={tab !== 'conversations'} className="flex flex-col gap-2">
          {conversations.map(session => sessionRow(session))}
        </div>
      </div>
      {tab === 'projects' && <Button size="sm" variant="ghost" className="mt-2 shrink-0 justify-start text-muted-foreground" onClick={props.onOpenArchived ?? props.onOpenProject}>已归档项目</Button>}
    </nav>
  )
}
