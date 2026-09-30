'use client'

import {createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {useRouter} from 'next/navigation'
import {projectApi} from '@/lib/api/project'
import {ProjectPicker} from '@/components/project-picker'
import type {ProjectView} from '@/lib/api/types'

type ProjectsContext = {projects: ProjectView[]; total: number; loading: boolean; error: string | null; refresh: () => Promise<void>; more: () => Promise<void>; openProject: () => void}
const Context = createContext<ProjectsContext | null>(null)
export function ProjectsProvider({children}: {children: ReactNode}) {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const count = useRef(50)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++request.current
    try {
      // 分页仍最多100；已加载更多页时逐页读取，不加载事件。
      const pages = []
      for (let offset = 0; offset < count.current; offset += 50) {
        const page = await projectApi.list(false, offset)
        pages.push(...page.projects)
        if (current !== request.current) return
        setTotal(page.total)
        if (offset + 50 >= page.total) break
      }
      if (current === request.current) {setProjects(pages); setError(null)}
    } catch (err) {if (current === request.current) setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {if (current === request.current) setLoading(false)}
  }, [])
  useEffect(() => {
    void refresh()
    const visible = () => {if (document.visibilityState !== 'hidden') void refresh()}
    const timer = setInterval(visible, 5000)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {request.current++; clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible)}
  }, [refresh])
  const more = useCallback(async () => {count.current += 50; await refresh()}, [refresh])
  const openProject = useCallback(() => setOpen(true), [])
  return <Context.Provider value={{projects, total, loading, error, refresh, more, openProject}}>
    {children}
    <ProjectPicker hideTrigger open={open} onOpenChange={setOpen} onChanged={() => void refresh()} onSelect={project => {if (project) {void refresh(); router.push(`/projects/${project.id}`)}}}/>
  </Context.Provider>
}
export function useProjects() {return useContext(Context)}
