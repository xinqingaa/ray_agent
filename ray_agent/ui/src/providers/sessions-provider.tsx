'use client'

import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react'
import {sessionApi} from '@/lib/api'
import type {Session, SessionStatus} from '@/lib/api'
import {emitCatalog} from '@/lib/catalog-bus'

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

/**
 * 从 API 返回值中安全提取 Session 数组
 * 兼容 data 为 { sessions: [...] } / 直接数组 / null 等格式
 */
function normalizeSessions(raw: unknown): Session[] {
  if (Array.isArray(raw)) return raw as Session[]
  if (raw && typeof raw === 'object' && 'sessions' in raw) {
    return Array.isArray((raw as Record<string, unknown>).sessions)
      ? ((raw as Record<string, unknown>).sessions as Session[])
      : []
  }
  return []
}

// ==================== Context ====================

export type WaitKind = 'reply' | 'approval'

type SessionsContextValue = {
  sessions: Session[]
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
  patchSession: (sessionId: string, patch: Partial<Pick<Session, 'status' | 'title'>>) => void
  /** 当前打开的会话刚写入的状态；项目子列表不在独立对话数组里，靠它覆盖 */
  liveSession: {id: string; status: SessionStatus} | null
  deleteSession: (sessionId: string) => Promise<boolean>
}

const SessionsContext = createContext<SessionsContextValue | null>(null)

// ==================== Provider ====================

/**
 * 会话列表数据 Provider
 *
 * 放置在 root layout 中，确保不会因为侧边栏展开/折叠而重新挂载。
 *
 * 数据流:
 *  1. 挂载后立即通过 REST GET /sessions 获取初始数据（仅一次）
 *  2. 同时建立 SSE POST /sessions/stream 长连接，接收实时推送
 *  3. SSE 断开后自动指数退避重连
 *  4. refresh() 可手动通过 REST 拉取
 */
export function SessionsProvider({children}: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [liveSession, setLiveSession] = useState<{id: string; status: SessionStatus} | null>(null)
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null)
  const [waitKinds, setWaitKinds] = useState<Record<string, WaitKind>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cleanupRef = useRef<(() => void) | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 确保 REST 初始请求只发起一次（防止 Strict Mode 重复） */
  const initialFetchedRef = useRef(false)
  /** 标记 SSE 是否已经推送过数据，防止 REST 回调覆盖更新的 SSE 数据 */
  const sseReceivedRef = useRef(false)

  // ---------- 手动刷新 ----------
  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const raw = await sessionApi.getSessions()
      const next = normalizeSessions(raw)
      setSessions((current) => sameSessions(current, next) ? current : next)
    } catch (err) {
      console.error('[Sessions] REST 获取失败:', err)
      setError(err instanceof Error ? err.message : '获取会话列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // ---------- 初始 REST 请求（仅一次） ----------
  useEffect(() => {
    if (initialFetchedRef.current) return
    initialFetchedRef.current = true

    sessionApi
      .getSessions()
      .then((raw) => {
        // 仅在 SSE 尚未推送过数据时更新，防止用旧数据覆盖 SSE 已推送的新数据
        if (!sseReceivedRef.current) {
          const next = normalizeSessions(raw)
          setSessions((current) => sameSessions(current, next) ? current : next)
        }
        setLoading(false)
        setError(null)
      })
      .catch((err) => {
        console.error('[Sessions] 初始获取失败:', err)
        setError(err instanceof Error ? err.message : '获取会话列表失败')
        setLoading(false)
      })
  }, [])

  // ---------- SSE 实时订阅 ----------
  // 同源 HTTP/1.1 只有 6 条连接。每个标签页各开一条列表流时，三个会话页会把连接占满，
  // 点击后的导航请求一直排在队列里。可见标签页共用一条列表流；页面隐藏时放开这条连接。
  useEffect(() => {
    let mounted = true
    let retryCount = 0
    let leader = false
    let lastLeaderAt = 0
    const tabId = crypto.randomUUID()
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ray-agent-sessions')

    const disconnect = () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }

    const applySessions = (next: Session[]) => {
      if (!mounted) return
      sseReceivedRef.current = true
      setSessions((current) => sameSessions(current, next) ? current : next)
      setLoading(false)
      setError(null)
    }

    const connect = () => {
      if (!mounted || !leader || document.visibilityState === 'hidden') return
      disconnect()

      cleanupRef.current = sessionApi.streamSessions(
        (newSessions) => {
          if (!mounted || !leader) return
          retryCount = 0
          applySessions(newSessions)
          channel?.postMessage({type: 'sessions', tabId, sessions: newSessions})
        },
        (err) => {
          if (!mounted || !leader) return
          console.warn('[Sessions] SSE 断开:', err.message)
          cleanupRef.current = null

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
          retryTimerRef.current = setTimeout(connect, delay)
        },
        (hint) => {
          if (!mounted || !leader) return
          emitCatalog(hint)
          channel?.postMessage({type: 'catalog', tabId, hint})
        },
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
      } else if (msg.type === 'catalog' && msg.hint && (msg.hint.kind === 'session' || msg.hint.kind === 'project') && msg.hint.id) {
        lastLeaderAt = Date.now()
        if (!leader) emitCatalog({kind: msg.hint.kind, id: String(msg.hint.id)})
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
  }, [])

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

  const patchSession = useCallback((sessionId: string, patch: Partial<Pick<Session, 'status' | 'title'>>) => {
    if (patch.status) {
      const status = patch.status
      setLiveSession((prev) => prev?.id === sessionId && prev.status === status ? prev : {id: sessionId, status})
    }
    setSessions((prev) => {
      let changed = false
      const next = prev.map((item) => {
        if (item.session_id !== sessionId) return item
        const status = patch.status ?? item.status
        const title = patch.title ?? item.title
        if (status === item.status && title === item.title) return item
        changed = true
        return {...item, status, title}
      })
      return changed ? next : prev
    })
  }, [])

  // ---------- 删除会话 ----------
  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      await sessionApi.deleteSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId))
      return true
    } catch {
      return false
    }
  }, [])

  return (
    <SessionsContext.Provider value={{sessions, compactingSessionId, setCompactingSessionId, waitKinds, setWaitKind, loading, error, refresh, patchSession, deleteSession, liveSession}}>
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

