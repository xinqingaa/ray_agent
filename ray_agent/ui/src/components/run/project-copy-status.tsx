'use client'

import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import {Button} from '@/components/ui/button'

type Copies = Awaited<ReturnType<typeof projectApi.fileCopies>>
type CopyState = {projectId: string; copies: Copies; error: string | null; loaded: boolean; refresh: () => Promise<void>}
const Context = createContext<CopyState | null>(null)
export const useProjectCopies = () => useContext(Context)

/** 同一条时间线只轮询一次；副本发布与补存的回执不改写历史消息。 */
export function ProjectCopiesProvider({projectId, children}: {projectId?: string; children: ReactNode}) {
  return <ProjectCopiesState key={projectId ?? 'independent'} projectId={projectId}>{children}</ProjectCopiesState>
}

function ProjectCopiesState({projectId, children}: {projectId?: string; children: ReactNode}) {
  const epoch = useRef(0)
  const [copies, setCopies] = useState<Copies>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const refresh = useCallback(async () => {
    if (!projectId) return
    const token = ++epoch.current
    try {
      const result = await projectApi.fileCopies(projectId)
      if (token === epoch.current) {setCopies(result); setError(null); setLoaded(true)}
    } catch (error) {
      if (token === epoch.current) setError(error instanceof Error ? error.message : '副本状态读取失败')
      throw error
    }
  }, [projectId])
  useEffect(() => {
    let live = true
    const counter = epoch
    counter.current++
    if (!projectId) return
    const read = async () => {
      const token = ++counter.current
      try {
        const result = await projectApi.fileCopies(projectId)
        if (live && token === counter.current) {setCopies(result); setError(null); setLoaded(true)}
      } catch (error) {if (live && token === counter.current) setError(error instanceof Error ? error.message : '副本状态读取失败')}
    }
    void read()
    const visible = () => {if (document.visibilityState !== 'hidden') void read()}
    let timer: number | undefined
    const unsubscribe = subscribeCatalog((hint) => {
      if (!projectId || hint.kind !== 'project' || hint.id !== projectId) return
      window.clearTimeout(timer)
      timer = window.setTimeout(visible, 300)
    })
    window.addEventListener('focus', visible)
    return () => {live = false; counter.current++; window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', visible)}
  }, [projectId])
  return <Context.Provider value={projectId ? {projectId, copies, error, loaded, refresh} : null}>
    {projectId && error && <p role="alert" className="text-xs text-state-failed">项目副本状态未确认：{error}<Button size="xs" variant="ghost" onClick={() => void refresh().catch(() => {})}>重新读取</Button></p>}
    {children}
  </Context.Provider>
}

export function AttachmentCopyStatus({attachmentId, hideReady = false}: {attachmentId: string; hideReady?: boolean}) {
  const state = useProjectCopies()
  if (!state) return null
  const copy = state.copies.find(item => item.copy_key === `attachment:${attachmentId}` && item.kind === 'attachment')
  if (hideReady && copy?.state === 'ready' && !state.error) return null
  const text = state.error ? '项目副本状态未确认' : !state.loaded ? '正在读取项目副本' : !copy ? '未找到项目持久副本关联' : copy.state === 'ready' ? `已存入项目 · ${copy.path}` : copy.error ? `未存入项目：${copy.error}` : '已受理，等待存入项目'
  return <span className={copy?.state === 'ready' && !state.error ? 'text-muted-foreground' : 'text-state-waiting'}>{text}</span>
}
