'use client'

import {createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {useRouter} from 'next/navigation'
import {projectApi} from '@/lib/api/project'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'
import type {ProjectView} from '@/lib/api/types'
import {ProjectPicker} from '@/components/project-picker'

function projectSignature(project: ProjectView) {
  const operation = project.file_operation
  return [
    project.id, project.name, project.available, project.reason, project.archived,
    project.occupying_session_id, project.active_run_status, project.active_run_reason,
    project.task_count, project.files_size, project.files_size_stale, project.write_blocked_reason,
    operation?.operation_id, operation?.state, operation?.phase, operation?.error,
  ].join('\0')
}

function sameProjects(current: ProjectView[], next: ProjectView[]) {
  return current.length === next.length && current.every((item, index) => projectSignature(item) === projectSignature(next[index]))
}

type ProjectsContext = {projects: ProjectView[]; total: number; loading: boolean; error: string | null; refresh: () => Promise<void>; more: () => Promise<void>; openProject: () => void; navigationTab: 'conversations' | 'projects'; setNavigationTab: (tab: 'conversations' | 'projects') => void; navigationRequest: number; createProject: () => void; importProject: () => void; openArchived: () => void}
const Context = createContext<ProjectsContext | null>(null)
export function ProjectsProvider({children}: {children: ReactNode}) {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'create' | 'archived'>('create')
  const [upload, setUpload] = useState(false)
  const [navigationTab, setNavigationTab] = useState<'conversations' | 'projects'>('conversations')
  const [navigationRequest, setNavigationRequest] = useState(0)
  const count = useRef(50)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++request.current
    try {
      // 分页仍最多100；已加载更多页时逐页读取，不加载事件。
      const pages: ProjectView[] = []
      for (let offset = 0; offset < count.current; offset += 50) {
        const page = await projectApi.list(false, offset)
        pages.push(...page.projects)
        if (current !== request.current) return
        setTotal(page.total)
        if (offset + 50 >= page.total) break
      }
      if (current === request.current) {
        setProjects((previous) => sameProjects(previous, pages) ? previous : pages)
        setError(null)
      }
    } catch (err) {if (current === request.current) setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {if (current === request.current) setLoading(false)}
  }, [])
  useEffect(() => {
    void refresh()
    const visible = () => {if (document.visibilityState !== 'hidden') void refresh()}
    let hidden = document.visibilityState === 'hidden'
    const onVisibility = () => {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden === hidden) return
      hidden = nowHidden
      if (!nowHidden) void refresh()
    }
    let timer: number | undefined
    const unsubscribe = subscribeCatalog((hint) => {
      if (hint.kind !== 'project') return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {if (document.visibilityState !== 'hidden') void refresh()}, 300)
    })
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', onVisibility)
    const generation = request
    return () => {generation.current++; window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', onVisibility)}
  }, [refresh])
  const more = useCallback(async () => {count.current += 50; await refresh()}, [refresh])
  const openProject = useCallback(() => {setNavigationTab('projects'); setNavigationRequest(n => n + 1)}, [])
  const createProject = () => {setPickerMode('create'); setOpen(true)}
  const openArchived = () => {setPickerMode('archived'); setOpen(true)}
  const importProject = () => setUpload(true)
  const openProjectPage = (projectId: string) => {
    void refresh()
    router.push(`/projects/${projectId}`)
  }
  return <Context.Provider value={{projects, total, loading, error, refresh, more, openProject, navigationTab, setNavigationTab, navigationRequest, createProject, importProject, openArchived}}>
    {children}
    <ProjectUploadDialog open={upload} onClose={() => setUpload(false)} onCreated={project => openProjectPage(project.id)}/>
    <ProjectPicker key={pickerMode} mode={pickerMode} hideTrigger open={open} onOpenChange={setOpen} onChanged={() => void refresh()} onSelect={project => {if (!project) return; if (pickerMode === 'archived') {void refresh(); router.push(`/projects/${project.id}`)} else openProjectPage(project.id)}}/>
  </Context.Provider>
}
export function useProjects() {return useContext(Context)}
