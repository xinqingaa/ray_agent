import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'
import {sessionApi} from '@/lib/api'
import type {Session, SessionStatus} from '@/lib/api'
import {emitCatalog} from '@/lib/catalog-bus'
import {sessionScope} from '@/lib/workspace-state'

function sessionSignature(item: Session) {
  return [
    item.session_id, item.status, item.title, item.latest_message, item.latest_message_at,
    item.unread_message_count, item.summary_state, item.summary_generation,
  ].join('\0')
}

function sameSessions(current: Session[], next: Session[]) {
  return current.length === next.length && current.every((item, index) => sessionSignature(item) === sessionSignature(next[index]))
}

/** 重连配置 */
const RETRY_CONFIG = {
  maxRetries: 10,
  baseDelay: 1000,
  maxDelay: 30_000,
} as const

type SessionDirectory = {sessions: Session[]; loaded: boolean; loading: boolean; error: string | null}
const INITIAL_DIRECTORY: SessionDirectory = {sessions: [], loaded: false, loading: true, error: null}

// ==================== Context ====================

export type WaitKind = 'reply' | 'approval'

type SessionsContextValue = {
  sessions: Session[]
  directories: Readonly<Record<string, SessionDirectory>>
  loading: boolean
  error: string | null
  /** 当前正在手动压缩的会话；不是运行状态，刷新列表不会覆盖 */
  compactingSessionId: string | null
  setCompactingSessionId: React.Dispatch<React.SetStateAction<string | null>>
  /** 已打开会话记下的等待原因；列表接口没有这个字段，刷新不会清掉 */
  waitKinds: Record<string, WaitKind>
  setWaitKind: (sessionId: string, kind: WaitKind | null) => void
  /** 手动刷新（通过 REST 接口拉取一次） */
  refresh: () => Promise<void>
  /** 用详情里的状态更新列表中的一项，避免徽标停在旧的「运行中」 */
  patchSession: (sessionId: string, patch: Partial<Pick<Session, 'status' | 'title'>>, owner?: string | null) => void
  /** 当前打开的会话刚写入的状态；当前会话不在已加载分页里时，靠它覆盖 */
  liveSession: {id: string; status: SessionStatus} | null
  /** 失败时抛出带中文说明的 Error，调用方（如确认弹框）负责展示 */
  deleteSession: (sessionId: string, owner?: string | null) => Promise<void>
}

const SessionsContext = createContext<SessionsContextValue | null>(null)

// ==================== Provider ====================

/** 目录快照按范围保留，只有当前范围建立实时会话列表订阅。 */
export function SessionsProvider({children, workspaceId = null}: { children: React.ReactNode; workspaceId?: string | null }) {
  const key = workspaceId ?? ''
  const [directories, setDirectories] = useState<Record<string, SessionDirectory>>({})
  const {sessions, loading, error} = directories[key] ?? INITIAL_DIRECTORY
  const [live, setLiveSession] = useState<{key: string; id: string; status: SessionStatus} | null>(null)
  const liveSession = live?.key === key ? live : null
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null)
  const [waitKinds, setWaitKinds] = useState<Record<string, WaitKind>>({})
  const generation = useMemo(() => ({scope: sessionScope(workspaceId), read: 0, stream: 0}), [workspaceId])

  const updateDirectory = useCallback((id: string, update: (previous: SessionDirectory) => SessionDirectory) => {
    setDirectories(current => {
      const previous = current[id] ?? INITIAL_DIRECTORY
      const next = update(previous)
      return next === previous ? current : {...current, [id]: next}
    })
  }, [])

  const refresh = useCallback(async () => {
    const read = ++generation.read
    const stream = generation.stream
    updateDirectory(key, current => current.loading && !current.error ? current : {...current, loading: true, error: null})
    try {
      const {sessions: next} = await sessionApi.getSessions(0, generation.scope)
      if (generation.read !== read || generation.stream !== stream) return
      updateDirectory(key, current => ({
        sessions: sameSessions(current.sessions, next) ? current.sessions : next, loaded: true, loading: false, error: null,
      }))
    } catch (err) {
      if (generation.read !== read || generation.stream !== stream) return
      updateDirectory(key, current => ({...current, loading: false, error: err instanceof Error ? err.message : '获取会话列表失败'}))
    }
  }, [generation, key, updateDirectory])

  useEffect(() => {
    void refresh()
    return () => {generation.read++}
  }, [generation, refresh])

  // ---------- SSE 实时订阅 ----------
  // 同源 HTTP/1.1 只有 6 条连接。每个标签页各开一条列表流时，三个会话页会把连接占满，
  // 点击后的导航请求一直排在队列里。可见标签页共用一条列表流；页面隐藏时放开这条连接。
  useEffect(() => {
    let mounted = true
    let retryCount = 0
    let leader = false
    let lastLeaderAt = 0
    const tabId = crypto.randomUUID()
    let cleanup: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(workspaceId ? `ray-agent-sessions:${workspaceId}` : 'ray-agent-sessions')

    const disconnect = () => {
      if (cleanup) {
        cleanup()
        cleanup = null
      }
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const applySessions = (next: Session[]) => {
      if (!mounted) return
      generation.stream++
      updateDirectory(key, current => {
        const same = sameSessions(current.sessions, next)
        if (same && !current.loading && !current.error) return current
        return {sessions: same ? current.sessions : next, loaded: true, loading: false, error: null}
      })
    }

    const connect = () => {
      if (!mounted || !leader || document.visibilityState === 'hidden') return
      disconnect()

      cleanup = sessionApi.streamSessions(
        (newSessions) => {
          if (!mounted || !leader) return
          retryCount = 0
          applySessions(newSessions)
          channel?.postMessage({type: 'sessions', tabId, sessions: newSessions})
        },
        (err) => {
          if (!mounted || !leader) return
          console.warn('[Sessions] SSE 断开:', err.message)
          cleanup = null

          if (retryCount >= RETRY_CONFIG.maxRetries) {
            console.error('[Sessions] 超过最大重试次数，停止重连')
            return
          }

          const delay = Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(2, retryCount),
            RETRY_CONFIG.maxDelay,
          )
          retryCount++
          console.log(`[Sessions] ${delay}ms 后尝试重连（第 ${retryCount} 次）`)
          retryTimer = setTimeout(connect, delay)
        },
        (hint) => {
          if (!mounted || !leader) return
          emitCatalog(hint)
          channel?.postMessage({type: 'catalog', tabId, hint})
        },
        generation.scope,
      )
    }

    const resign = () => {
      if (!leader) return
      leader = false
      retryCount = 0
      disconnect()
      channel?.postMessage({type: 'resign', tabId})
    }

    const claim = () => {
      if (!mounted || document.visibilityState === 'hidden' || leader) return
      if (lastLeaderAt && Date.now() - lastLeaderAt < 2000) return
      leader = true
      channel?.postMessage({type: 'leader', tabId})
      connect()
    }

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as {type?: string; tabId?: string; sessions?: Session[]; hint?: {kind?: string; id?: string}} | null
      if (!msg || msg.tabId === tabId) return
      if (msg.type === 'leader' && msg.tabId) {
        lastLeaderAt = Date.now()
        if (leader && msg.tabId < tabId) resign()
        else if (leader) channel?.postMessage({type: 'leader', tabId})
      } else if (msg.type === 'sessions' && Array.isArray(msg.sessions)) {
        lastLeaderAt = Date.now()
        if (!leader) applySessions(msg.sessions)
      } else if (msg.type === 'catalog' && msg.hint && msg.hint.kind === 'session' && msg.hint.id) {
        lastLeaderAt = Date.now()
        if (!leader) emitCatalog({kind: 'session', id: String(msg.hint.id)})
      } else if (msg.type === 'resign') {
        if (leader) return
        window.setTimeout(claim, 80 + Math.random() * 120)
      } else if (msg.type === 'ping' && leader) {
        channel?.postMessage({type: 'leader', tabId})
      }
    }

    channel?.addEventListener('message', onMessage)
    channel?.postMessage({type: 'ping', tabId})
    const claimTimer = window.setTimeout(claim, 160)
    const heartbeat = window.setInterval(() => {
      if (!mounted) return
      if (leader) channel?.postMessage({type: 'leader', tabId})
      else if (document.visibilityState !== 'hidden' && Date.now() - lastLeaderAt > 4000) claim()
    }, 2000)

    let hidden = document.visibilityState === 'hidden'
    const onVisibility = () => {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden === hidden) return
      hidden = nowHidden
      if (nowHidden) resign()
      else {
        channel?.postMessage({type: 'ping', tabId})
        window.setTimeout(claim, 160)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (!channel) claim()

    return () => {
      mounted = false
      window.clearTimeout(claimTimer)
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibility)
      resign()
      channel?.removeEventListener('message', onMessage)
      channel?.close()
    }
  }, [workspaceId, generation, key, updateDirectory])

  const setWaitKind = useCallback((sessionId: string, kind: WaitKind | null) => {
    setWaitKinds((prev) => {
      if (kind == null) {
        if (!(sessionId in prev)) return prev
        const next = {...prev}
        delete next[sessionId]
        return next
      }
      if (prev[sessionId] === kind) return prev
      return {...prev, [sessionId]: kind}
    })
  }, [])

  const patchSession = useCallback((sessionId: string, patch: Partial<Pick<Session, 'status' | 'title'>>, owner = workspaceId) => {
    const ownerKey = owner ?? ''
    if (patch.status) {
      const status = patch.status
      setLiveSession(prev => prev?.key === ownerKey && prev.id === sessionId && prev.status === status ? prev : {key: ownerKey, id: sessionId, status})
    }
    updateDirectory(ownerKey, current => {
      const index = current.sessions.findIndex(item => item.session_id === sessionId)
      if (index < 0) return current
      const item = current.sessions[index]
      const next = {...item, ...patch}
      if (next.status === item.status && next.title === item.title) return current
      const sessions = current.sessions.slice()
      sessions[index] = next
      return {...current, sessions}
    })
  }, [updateDirectory, workspaceId])

  const deleteSession = useCallback(async (sessionId: string, owner = workspaceId): Promise<void> => {
    try {
      await sessionApi.deleteSession(sessionId)
    } catch {
      throw new Error('删除对话失败，请重试')
    }
    updateDirectory(owner ?? '', current => ({
      ...current, sessions: current.sessions.filter(item => item.session_id !== sessionId),
    }))
  }, [updateDirectory, workspaceId])

  return (
    <SessionsContext.Provider value={{sessions, directories, compactingSessionId, setCompactingSessionId, waitKinds, setWaitKind, loading, error, refresh, patchSession, deleteSession, liveSession}}>
      {children}
    </SessionsContext.Provider>
  )
}

// ==================== Hook ====================

/**
 * 获取会话列表数据的 Hook
 *
 * 必须在 <SessionsProvider> 内使用
 */
export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext)
  if (!ctx) {
    throw new Error('useSessions 必须在 SessionsProvider 内使用')
  }
  return ctx
}

/** 目录页等没有列表 Provider 的地方返回 null，不把压缩状态当成运行状态。 */
export function useCompactingSessionId(): string | null {
  return useContext(SessionsContext)?.compactingSessionId ?? null
}

/** 已打开过的等待会话记住回复或批准；没打开过、列表也没有原因时为空。 */
export function useSessionWaitKind(sessionId: string): WaitKind | null {
  return useContext(SessionsContext)?.waitKinds[sessionId] ?? null
}

