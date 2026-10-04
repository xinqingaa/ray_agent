'use client'

import {useRef, useState, type MouseEvent} from 'react'
import Link from 'next/link'
import {ChevronDown, ChevronRight, Folder, Plus, MoreHorizontal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {SessionItem} from '@/components/session-item'
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
  file_operation?: import("@/lib/api/types").ProjectFileOperation | null
  conversations: Session[]
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
  /** 目录示例保留导航交互，但不访问产品路由。 */
  preview?: boolean
}

/** 侧栏顶部的新建按钮。对话标签打开首页草稿，项目标签选择空白项目或从文件夹创建。 */
export function NavigationCreateButton({tab, onIndependent, onCreateProject, onImportProject, onOpenProject}: {
  tab: 'conversations' | 'projects'
  onIndependent: () => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onOpenProject?: () => void
}) {
  if (tab === 'conversations') {
    return <Button variant="default" size="sm" className="h-7 gap-1.5 px-2.5 text-[13px] font-medium" onClick={onIndependent}>
      <Plus className="size-3.5"/>
      <span>新对话</span>
    </Button>
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" className="h-7 gap-1.5 px-2.5 text-[13px] font-medium">
          <Plus className="size-3.5"/>
          <span>新建</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onCreateProject ?? onOpenProject}>空白项目</DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportProject ?? onOpenProject}>从文件夹创建</DropdownMenuItem>
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
  const sessionRow = (session: Session, showTime = true) => <SessionItem key={session.session_id} session={session} isActive={selectedSession === session.session_id}
    href={preview ? undefined : `/sessions/${session.session_id}`}
    onClick={() => props.onNavigate?.(`/sessions/${session.session_id}`)}
    onDelete={props.onSessionDelete} onRename={props.onSessionRename} showTime={showTime}/>
  return (
    <nav aria-label="项目与对话" className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="导航模式" className="mb-3 flex h-9 shrink-0 rounded-full bg-muted p-1">
        {(['conversations', 'projects'] as const).map(value => <button key={value} type="button" role="tab" id={`nav-${value}`} aria-controls="navigation-list" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          onClick={() => switchTab(value)} onKeyDown={event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault(); const next = event.key === 'Home' ? 'conversations' : event.key === 'End' ? 'projects' : tab === 'projects' ? 'conversations' : 'projects'; switchTab(next); document.getElementById(`nav-${next}`)?.focus()}}}
          className={cn('flex-1 rounded-full text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === value ? 'bg-card font-medium text-foreground shadow-sm' : 'font-normal text-muted-foreground')}>{value === 'conversations' ? '对话' : '项目'}</button>)}
      </div>
      <div ref={scroll} id="navigation-list" role="tabpanel" aria-labelledby={`nav-${tab}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div hidden={tab !== 'projects'}>
          {props.loading && <p className="px-3 py-3 text-meta text-faint">正在读取项目</p>}
          {props.error && <div className="px-3 py-3"><p role="alert" className="text-meta text-state-failed">{props.error}</p><Button size="sm" variant="ghost" onClick={props.onRetry}>重试</Button></div>}
          {!props.loading && !props.error && projects.length === 0 && (
            <div className="mx-2 space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">创建你的第一个项目</h3>
                <p className="text-xs text-muted-foreground">项目保留材料、产出和对话记忆，适合持续完成的工作。</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="outline" className="justify-start" onClick={props.onOpenProject}>
                  <Plus className="size-3.5"/>
                  空白项目
                </Button>
                <Button size="sm" variant="outline" className="justify-start" onClick={props.onOpenProject}>
                  <Folder className="size-3.5"/>
                  从文件夹创建
                </Button>
              </div>
            </div>
          )}
          {projects.map(project => {
            const selected = props.selectedProject === project.id
            const openProject = (event: MouseEvent) => {if (preview) event.preventDefault(); props.onNavigate?.(`/projects/${project.id}`)}
            const label=!project.available?'不可用':project.file_operation?.state==='failed'?'需修复':project.active_run_status==='waiting'?project.active_run_reason==='approval'?'等待审批':'等待回复':project.active_run_status?'运行中':project.file_operation?'文件处理中':project.archived?'已归档':null
            const details=[!project.available?project.reason:null,project.file_operation?.error,project.active_run_status,project.archived?'已归档':null].filter(Boolean).join('；')
            return <div key={project.id}>
            <div className={cn('group/project rounded-md', selected ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/70')}>
              <Link href={`/projects/${project.id}`} aria-current={selected ? 'page' : undefined} title={project.available ? project.name : `${project.name}：${project.reason ?? '目录不可用'}`} onClick={openProject} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Folder className="size-4 shrink-0 text-muted-foreground"/>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    {label && (
                      <span title={details || label} className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',!project.available || project.file_operation?.state==='failed'?'bg-red-500/10 text-red-600 dark:text-red-400':project.active_run_status || project.file_operation?'bg-amber-500/10 text-amber-600 dark:text-amber-400':'bg-muted text-muted-foreground')}>
                        {label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                      <Button variant="ghost" size="icon-xs" aria-label={`${project.name} 的操作`} className="text-muted-foreground opacity-0 hover:bg-muted group-hover/project:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
                        <MoreHorizontal className="size-4"/>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild><Link href={`/projects/${project.id}`} onClick={openProject}>{project.archived ? '打开项目' : '在此项目新对话'}</Link></DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => props.onProjectSettings(project.id)}>项目设置</DropdownMenuItem>
                      {!project.archived && <DropdownMenuItem onSelect={() => props.onArchive(project.id)}>归档项目</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button type="button" aria-label={`${expansion.items[project.id] ? '收起' : '展开'} ${project.name} 的对话`} aria-expanded={!!expansion.items[project.id]} onClick={(e) => {e.preventDefault(); onExpansion({...expansion, items: {...expansion.items, [project.id]: !expansion.items[project.id]}})}} className="flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                    {expansion.items[project.id] ? <ChevronDown className="size-4"/> : <ChevronRight className="size-4"/>}
                  </button>
                </div>
              </Link>
            </div>
            {expansion.items[project.id] && <div className="ml-6 space-y-0.5 border-l pl-2 pt-1">
              {project.conversations.map(session => sessionRow(session, false))}
              {!project.archived && <Link href={`/projects/${project.id}`} onClick={openProject} className="block rounded-md px-2.5 py-2 text-sm text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">在此项目中新对话</Link>}
              {project.navigationError && <p role="alert" className="px-2 py-2 text-xs text-state-failed">{project.navigationError}</p>}
            </div>}
          </div>})}
          {props.onMoreProjects && <Button size="sm" variant="ghost" onClick={props.onMoreProjects}>更多项目</Button>}
        </div>
        <div hidden={tab !== 'conversations'}>
          {!conversations.length && !props.loading && (
            <div className="mx-2 space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">开始你的第一次对话</h3>
                <p className="text-xs text-muted-foreground">适合单次问答、快速处理附件或探索想法。</p>
              </div>
              <Button size="sm" variant="default" className="w-full justify-start" asChild>
                <Link href="/">
                  <Plus className="size-3.5"/>
                  开始新对话
                </Link>
              </Button>
            </div>
          )}
          {conversations.map(session => sessionRow(session))}
        </div>
      </div>
      {tab === 'projects' && <Button size="sm" variant="ghost" className="mt-2 shrink-0 justify-start text-muted-foreground" onClick={props.onOpenArchived ?? props.onOpenProject}>已归档项目</Button>}
    </nav>
  )
}
