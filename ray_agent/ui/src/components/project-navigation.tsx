'use client'

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
  onIndependent: () => void
  onProjectSettings: (id: string) => void
  onArchive: (id: string) => void
  onSessionDelete: (session: Session) => void
  onSessionRename: (session: Session) => void
  onNavigate?: (path: string) => void
  /** 目录示例保留导航交互，但不访问产品路由。 */
  preview?: boolean
}

/** 左侧仅管理归属导航；展开状态由调用方持有，不随列表刷新重置。 */
export function ProjectNavigation(props: Props) {
  const {projects, conversations, expansion, onExpansion, selectedSession, preview} = props
  const toggleSection = (key: 'projects' | 'conversations') => onExpansion({...expansion, [key]: !expansion[key]})
  const sectionTitle = (key: 'projects' | 'conversations', label: string, addLabel: string, add: () => void) => (
    <div className="flex shrink-0 items-center gap-1 px-1 py-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 rounded-sm py-1 text-left text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={expansion[key]} onClick={() => toggleSection(key)}>
        {expansion[key] ? <ChevronDown className="size-3.5"/> : <ChevronRight className="size-3.5"/>}{label}
      </button>
      <Button variant="ghost" size="icon-xs" aria-label={addLabel} title={addLabel} onClick={add}><Plus/></Button>
    </div>
  )
  const sessionRow = (session: Session) => <SessionItem key={session.session_id} session={session} isActive={selectedSession === session.session_id}
    href={preview ? undefined : `/sessions/${session.session_id}`}
    onClick={() => props.onNavigate?.(`/sessions/${session.session_id}`)}
    onDelete={props.onSessionDelete} onRename={props.onSessionRename}/>
  return (
    <nav aria-label="项目与对话" className="flex h-full min-h-0 flex-col">
      <section aria-label="项目" className="flex min-h-0 flex-1 flex-col">
        {sectionTitle('projects', '项目', '打开项目', props.onOpenProject)}
        {expansion.projects && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {props.loading && <p className="px-3 py-3 text-meta text-faint">正在读取项目</p>}
          {props.error && <div className="px-3 py-3"><p role="alert" className="text-meta text-state-failed">{props.error}</p><Button size="sm" variant="ghost" onClick={props.onRetry}>重试</Button></div>}
          {!props.loading && !props.error && projects.length === 0 && <p className="px-3 py-3 text-meta text-faint">从 + 打开项目</p>}
          {projects.map(project => <div key={project.id}>
            <div className="group/project flex items-center gap-1 py-0.5">
              <button type="button" aria-label={`${expansion.items[project.id] ? '收起' : '展开'} ${project.name} 的对话`} aria-expanded={!!expansion.items[project.id]} onClick={() => onExpansion({...expansion, items: {...expansion.items, [project.id]: !expansion.items[project.id]}})} className="rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {expansion.items[project.id] ? <ChevronDown className="size-3.5"/> : <ChevronRight className="size-3.5"/>}
              </button>
              <Link href={`/projects/${project.id}`} aria-current={props.selectedProject === project.id ? 'page' : undefined} title={project.available ? project.name : `${project.name}：${project.reason ?? '目录不可用'}`} onClick={event => {if (preview) event.preventDefault(); props.onNavigate?.(`/projects/${project.id}`)}} className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring', props.selectedProject === project.id && 'bg-sidebar-accent')}>
                <Folder className="size-3.5 shrink-0 text-muted-foreground"/><span className="truncate">{project.name}</span>
                {project.active_run_status && <span className="shrink-0 text-[10px] text-state-waiting">{project.active_run_status === 'waiting' ? project.active_run_reason === 'approval' ? '等待审批' : '等待回复' : '运行中'}</span>}
                {!project.active_run_status && project.file_operation && <span className="shrink-0 text-[10px] text-state-waiting">{project.file_operation.state === 'failed' ? '等待修复' : '文件处理中'}</span>}
                {!project.available && <span className="shrink-0 text-[10px] text-faint">不可用</span>}
              </Link>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={`${project.name} 的操作`} className="opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"><MoreHorizontal/></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => props.onProjectSettings(project.id)}>项目设置</DropdownMenuItem><DropdownMenuItem onSelect={() => props.onArchive(project.id)}>归档项目</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </div>
            {expansion.items[project.id] && <div className="ml-5 border-l pl-1">
              {project.conversations.map(sessionRow)}
              {project.navigationError && <p role="alert" className="px-2 py-2 text-meta text-state-failed">{project.navigationError}</p>}
              {!project.navigationError && project.conversations.length === 0 && <p className="px-2 py-2 text-meta text-faint">从项目工作区发送，开始对话</p>}
            </div>}
          </div>)}
        </div>}
      </section>
      <section aria-label="独立对话" className="mt-auto flex shrink-0 flex-col border-t pt-1">
        {sectionTitle('conversations', '对话', '新独立对话', props.onIndependent)}
        {expansion.conversations && <div className="max-h-[32vh] min-h-0 overflow-y-auto overscroll-contain">
          {conversations.map(sessionRow)}
          {conversations.length === 0 && <p className="px-3 py-3 text-meta text-faint">从 + 开始独立对话</p>}
        </div>}
      </section>
    </nav>
  )
}
