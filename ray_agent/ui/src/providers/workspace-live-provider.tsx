import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {ApiError} from '@/lib/api/fetch'
import {historyApi} from '@/lib/api/workspace'
import type {WorkspaceChangeEvent, WorkspaceItem, WriteLease} from '@/lib/api/types'
import {reconnectDelayMs} from '@/lib/session-projection'
import {createChangeCollector, EMPTY_BATCH, type ChangeBatch} from '@/lib/workspace-changes'
import {useWorkspaces} from '@/providers/workspaces-provider'

/** 外部变更合并窗口：最后一次通知之后这么久才交出一批，避免大量写入时反复刷新 */
const CHANGE_DEBOUNCE_MS = 300
/** 有写入租约时，隔这么久读一次租约以发现释放（租约变化没有推送） */
const LEASE_POLL_MS = 3000

/** 最近一次交出的变化批次；`signal` 每交出一批加一，消费者以它为刷新触发。 */
export type FolderChange = {signal: number; batch: ChangeBatch}

type WorkspaceLiveValue = {
  change: FolderChange
  /** 文件夹当前的写入租约；没有写入者为 null */
  lease: WriteLease | null
  refreshLease: () => Promise<void>
  /** 文件夹失联的原因（核心给出）；可用时为 null */
  unavailableReason: string | null
  /** 应用自己改过文件夹（撤销等）后要求整体刷新并重读租约 */
  requestRefresh: () => void
}

const WorkspaceLiveContext = createContext<WorkspaceLiveValue | null>(null)

/**
 * 工作区页打开期间的实时状态：订阅文件夹的外部变更流（SSE），断线按会话事件流同样的退避重连，重连后整体刷新；
 * `availability` 立即写回工作区的文件夹状态；同时维护写入租约。离开工作区页即退订。
 */
export function WorkspaceLiveProvider({workspace, children}: {workspace: WorkspaceItem; children: ReactNode}) {
  const {upsert} = useWorkspaces()
  const id = workspace.id
  const [change, setChange] = useState<FolderChange>({signal: 0, batch: EMPTY_BATCH})
  const [lease, setLease] = useState<WriteLease | null>(workspace.write_lease)
  const [unavailableReason, setReason] = useState<string | null>(null)
  const latest = useRef(workspace)
  latest.current = workspace
  const alive = useRef(true)

  const refreshLease = useCallback(async () => {
    try {
      const next = await historyApi.writeLease(id)
      if (alive.current) setLease(next)
    } catch {
      // 租约只是提示信息；读取失败时保持原状，下次变化或轮询再读
    }
  }, [id])

  const collectorRef = useRef<ReturnType<typeof createChangeCollector> | null>(null)

  useEffect(() => {
    alive.current = true
    let closed = false
    let retry = 0
    let missedWhileAway = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let stop: (() => void) | null = null
    const collector = createChangeCollector({
      delay: CHANGE_DEBOUNCE_MS,
      flush: batch => {
        setChange(current => ({signal: current.signal + 1, batch}))
        void refreshLease()
      },
    })
    collectorRef.current = collector

    const applyAvailability = (available: boolean, reason: string | null) => {
      setReason(available ? null : reason)
      const current = latest.current
      if (!current.folder) return
      const status = available ? 'available' : 'unavailable'
      if (current.folder.status !== status) upsert({...current, folder: {...current.folder, status}})
    }

    const onEvent = (event: WorkspaceChangeEvent) => {
      if (closed) return
      if (event.kind === 'ready') {
        retry = 0
        applyAvailability(event.available, event.reason)
        if (missedWhileAway) {
          missedWhileAway = false
          collector.push({kind: 'changed', paths: [], refresh: true})
        }
        void refreshLease()
      } else if (event.kind === 'availability') {
        applyAvailability(event.available, event.reason)
        // 恢复后文件夹内容可能已不同；失联时面板会换成不可用说明，不需要读目录
        if (event.available) collector.push({kind: 'changed', paths: [], refresh: true})
      } else collector.push(event)
    }

    const connect = () => {
      stop = historyApi.streamChanges(id, onEvent, error => {
        if (closed) return
        stop?.()
        // 工作区已不存在：不再重连，页面自己会显示“没有找到”
        if (error instanceof ApiError && error.status === 404) return
        missedWhileAway = true
        timer = setTimeout(connect, reconnectDelayMs(retry++))
      })
    }
    connect()

    return () => {
      closed = true
      alive.current = false
      if (timer) clearTimeout(timer)
      stop?.()
      collector.dispose()
      collectorRef.current = null
    }
  }, [id, refreshLease, upsert])

  // 有租约就轮询到它被释放；回到前台时再读一次
  useEffect(() => {
    if (!lease) return
    const timer = setInterval(() => void refreshLease(), LEASE_POLL_MS)
    return () => clearInterval(timer)
  }, [lease, refreshLease])
  useEffect(() => {
    const onFocus = () => {if (document.visibilityState !== 'hidden') void refreshLease()}
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refreshLease])

  const requestRefresh = useCallback(() => {
    const collector = collectorRef.current
    if (collector) {
      collector.push({kind: 'changed', paths: [], refresh: true})
      collector.flushNow()
    }
    void refreshLease()
  }, [refreshLease])

  const value = useMemo(
    () => ({change, lease, refreshLease, unavailableReason, requestRefresh}),
    [change, lease, refreshLease, unavailableReason, requestRefresh],
  )
  return <WorkspaceLiveContext.Provider value={value}>{children}</WorkspaceLiveContext.Provider>
}

export function useWorkspaceLive(): WorkspaceLiveValue {
  const value = useContext(WorkspaceLiveContext)
  if (!value) throw new Error('useWorkspaceLive 必须在 WorkspaceLiveProvider 内使用')
  return value
}
