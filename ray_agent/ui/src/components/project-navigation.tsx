'use client'

import {useState, type MouseEvent, type ReactNode} from 'react'
import Link from 'next/link'
import {ChevronRight} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
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
  /** 项目里的对话总数。0 时禁用展开；未提供时依据已加载对话判断。 */
  taskCount?: number
  navigationError?: string
}
export type NavigationExpansion = {projects: boolean; conversations: boolean; items: Record<string, boolean>}

type Props = {
  createAction?: ReactNode
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
  onProjectDelete?: (id: string) => void
  onSessionDelete: (session: Session) => void
  onSessionRename: (session: Session) => void
  onNavigate?: (path: string) => void
  onNewConversation?: (projectId: string) => void
  /** 目录示例保留导航交互，但不访问产品路由。 */
  preview?: boolean
}

const createButtonClass = 'group/create text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent'

/** 当前列表的新建入口，与导航同排并靠右，悬停时显示底色。 */
export function NavigationCreateButton({tab, onIndependent, onCreateProject, onImportProject, onOpenProject}: {
  tab: 'conversations' | 'projects'
  onIndependent: () => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onOpenProject?: () => void
}) {
  if (tab === 'conversations') {
    return (
      <Tooltip>
        <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={createButtonClass} aria-label="新建对话" onClick={onIndependent}>
          <NewChatIcon className="size-[18px]" aria-hidden="true"/>
        </Button></TooltipTrigger>
        <TooltipContent side="bottom">新建对话</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild><DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={createButtonClass} aria-label="新建项目">
            <NewProjectIcon className="size-[18px]" aria-hidden="true"/>
          </Button>
        </DropdownMenuTrigger></TooltipTrigger>
        <TooltipContent side="bottom">新建项目</TooltipContent>
      </Tooltip>
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
  const switchTab = (next: 'conversations' | 'projects') => {
    setLocalTab(next); props.onTabChange?.(next)
  }
  const sessionRow = (session: Session, waitKind?: 'reply' | 'approval') => <SessionItem key={session.session_id} session={session} isActive={selectedSession === session.session_id}
    href={preview ? undefined : `/sessions/${session.session_id}`}
    onClick={() => props.onNavigate?.(`/sessions/${session.session_id}`)}
    onDelete={props.onSessionDelete} onRename={props.onSessionRename} waitKind={waitKind}/>
  return (
    <nav aria-label="项目与对话" className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
      <SegmentedControl value={tab} onValueChange={switchTab} idPrefix="navigation" label="导航模式"
        className="min-w-0 flex-1" options={[
          {value: 'conversations', label: '对话'},
          {value: 'projects', label: '项目'},
        ]}/>
      {props.createAction && <div className="shrink-0">{props.createAction}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* 两页各自保留滚动容器，滑动过程中不卸载；非当前页不参与焦点和读屏。 */}
        <div className={cn('flex h-full w-[200%] transition-transform duration-200 ease-out motion-reduce:transition-none', tab === 'projects' && '-translate-x-1/2')}>
        <div id="navigation-panel-projects" role="tabpanel" aria-labelledby="navigation-projects" aria-hidden={tab !== 'projects'} inert={tab !== 'projects'} className="order-2 flex h-full w-1/2 shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain">
          {props.loading && <p className="px-2 py-3 text-meta text-faint">正在读取项目</p>}
          {props.error && <div className="px-2 py-3"><p role="alert" className="text-meta text-state-failed">{props.error}</p><Button size="sm" variant="ghost" onClick={props.onRetry}>重试</Button></div>}
          {projects.map(project => {
            const selected = props.selectedProject === project.id
            const canExpand = project.taskCount == null ? project.conversations.length > 0 || !!project.navigationError : project.taskCount > 0
            const open = canExpand && !!expansion.items[project.id]
            const toggleProject = () => {
              if (!canExpand) return
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
              <div className={cn("group/project relative flex min-h-9 items-center rounded-md", selected && !selectedSession && "bg-sidebar-accent")}>
                  <button type="button" aria-expanded={open} aria-controls={`project-conversations-${project.id}`} disabled={!canExpand} title={canExpand ? undefined : '还没有对话'} aria-label={`${open ? '收起' : '展开'} ${project.name} 的对话`} onClick={toggleProject} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-muted disabled:cursor-default disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}/>
                  </button>
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
                  {!project.archived && (props.onNewConversation ? (
                    <button type="button" aria-label={`${project.name} 中新对话`} title="在此项目中新对话" onClick={startConversation} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <NewChatIcon className="size-4"/>
                    </button>
                  ) : (
                    <Link href={`/projects/${project.id}#new-conversation`} aria-label={`${project.name} 中新对话`} title="在此项目中新对话" onClick={prepareConversation} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <NewChatIcon className="size-4"/>
                    </Link>
                  ))}

                </div>
              </div>
              <div id={`project-conversations-${project.id}`} aria-hidden={!open} inert={!open} className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}><div className="min-h-0 overflow-hidden"><div className="ml-8 flex flex-col gap-2 py-1">
                {!project.conversations.length && !project.navigationError && <p className="px-2 py-2 text-xs text-faint">正在读取对话</p>}
                {project.conversations.map(session => sessionRow(session, project.active_run_status === 'waiting' && project.occupying_session_id === session.session_id ? project.active_run_reason === 'approval' ? 'approval' : 'reply' : undefined))}
                {project.navigationError && <p role="alert" className="px-2 py-1 text-xs text-state-failed">{project.navigationError}</p>}
              </div></div></div>
            </div>})}
          {props.onMoreProjects && <Button size="sm" variant="ghost" className="mt-1" onClick={props.onMoreProjects}>更多项目</Button>}
        </div>
        <div id="navigation-panel-conversations" role="tabpanel" aria-labelledby="navigation-conversations" aria-hidden={tab !== 'conversations'} inert={tab !== 'conversations'} className="order-1 flex h-full w-1/2 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain">
          {conversations.map(session => sessionRow(session))}
        </div>
        </div>
      </div>
      {tab === 'projects' && <Button size="sm" variant="ghost" className="mt-2 shrink-0 justify-start text-muted-foreground" onClick={props.onOpenArchived ?? props.onOpenProject}>已归档项目</Button>}
    </nav>
  )
}
