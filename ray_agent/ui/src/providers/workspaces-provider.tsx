import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {workspaceApi} from '@/lib/api/workspace'
import {ApiError} from '@/lib/api/fetch'
import type {WorkspaceItem} from '@/lib/api/types'
import {sortWorkspaces} from '@/lib/workspace-state'

type WorkspacesValue = {
  workspaces: WorkspaceItem[]
  loading: boolean
  error: string | null
  /** 重新读取列表；列表会同时核对每个文件夹的可用性 */
  refresh: () => Promise<void>
  /** 把一次操作返回的最新工作区写回列表，避免等待下一次读取 */
  upsert: (item: WorkspaceItem) => void
  drop: (workspaceId: string) => void
}

const WorkspacesContext = createContext<WorkspacesValue | null>(null)

/** 回到前台时至少间隔这么久才重新核对文件夹，避免频繁切换窗口时反复扫盘 */
const FOCUS_REFRESH_MS = 5000

export function WorkspacesProvider({children}: {children: ReactNode}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const lastRead = useRef(0)

  const refresh = useCallback(async () => {
    const token = ++generation.current
    try {
      const next = await workspaceApi.list()
      if (token !== generation.current) return
      lastRead.current = Date.now()
      setWorkspaces(sortWorkspaces(next))
      setError(null)
    } catch (reason) {
      if (token !== generation.current) return
      setError(reason instanceof Error ? reason.message : '读取工作区失败')
    } finally {
      if (token === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const counter = generation
    const onFocus = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - lastRead.current > FOCUS_REFRESH_MS) void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      counter.current++
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  const upsert = useCallback((item: WorkspaceItem) => {
    setWorkspaces(current => sortWorkspaces(current.some(entry => entry.id === item.id)
      ? current.map(entry => entry.id === item.id ? item : entry) : [...current, item]))
  }, [])
  const drop = useCallback((workspaceId: string) => {
    setWorkspaces(current => current.filter(entry => entry.id !== workspaceId))
  }, [])

  const value = useMemo(() => ({workspaces, loading, error, refresh, upsert, drop}), [workspaces, loading, error, refresh, upsert, drop])
  return <WorkspacesContext.Provider value={value}>{children}</WorkspacesContext.Provider>
}

export function useWorkspaces(): WorkspacesValue {
  const value = useContext(WorkspacesContext)
  if (!value) throw new Error('useWorkspaces 必须在 WorkspacesProvider 内使用')
  return value
}

export type WorkspaceLookup =
  | {phase: 'loading'}
  | {phase: 'ready'; workspace: WorkspaceItem}
  | {phase: 'missing'}
  | {phase: 'error'; message: string}

/** 按 ID 取一个工作区：先看列表，列表里没有时单独读取，区分不存在与读取失败。 */
export function useWorkspace(workspaceId: string | null): WorkspaceLookup {
  const {workspaces, loading} = useWorkspaces()
  const listed = workspaces.find(item => item.id === workspaceId) ?? null
  const [fetched, setFetched] = useState<{id: string; result: WorkspaceLookup} | null>(null)
  useEffect(() => {
    if (!workspaceId || listed || loading) return
    let active = true
    workspaceApi.get(workspaceId)
      .then(item => {if (active) setFetched({id: workspaceId, result: item.status === 'deleting' ? {phase: 'missing'} : {phase: 'ready', workspace: item}})})
      .catch(reason => {
        if (!active) return
        const gone = reason instanceof ApiError && (reason.status === 404 || reason.code === 'not_found')
        setFetched({id: workspaceId, result: gone ? {phase: 'missing'} : {phase: 'error', message: reason instanceof Error ? reason.message : '读取工作区失败'}})
      })
    return () => {active = false}
  }, [workspaceId, listed, loading])
  if (listed) return {phase: 'ready', workspace: listed}
  if (loading) return {phase: 'loading'}
  return fetched?.id === workspaceId ? fetched.result : {phase: 'loading'}
}
