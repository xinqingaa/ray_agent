import type {PlanAcceptance} from '@/lib/api/types'
import type {StartOptions} from '@/hooks/use-start-task'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {sendRecoverably} from '@/lib/send-recovery'
import {subscribeCatalog} from '@/lib/catalog-bus'
import { sessionApi } from '@/lib/api/session'
import { normalizeEvent, normalizeEvents } from '@/lib/session-events'
import type { ApprovalDecision, RunEvent, SessionDetail, SSEEventData, SessionFile, TurnRequest } from '@/lib/api/types'
import {
  isTerminalRunStatus,
  mergeBySeq,
  projectSession,
  readEventSeq,
  reconnectDelayMs,
  streamDraftKey,
  type DeltaInput,
} from '@/lib/session-projection'
import type { SessionView } from '@/lib/session-view'

type SendOptions = StartOptions & {retry?: boolean; execute_plan?: PlanAcceptance}

export type UseSessionDetailResult = {
  session: SessionDetail | null
  /** 会话文件接口返回的列表，供当前会话页的文件入口使用 */
  files: SessionFile[]
  events: SSEEventData[]
  /** 由事件投影出的视图模型；W5 阶段二的页面改消费这一份 */
  view: SessionView | null
  loading: boolean
  error: Error | null
  refreshing: boolean
  refreshError: string | null
  refresh: () => Promise<void>
  refreshFiles: () => Promise<void>
  /** 只提交消息。retry 不再裁掉已有事件。提交期间 streaming 为 true，不改写运行状态 */
  sendMessage: (message: string, attachmentIds: string[], options?: SendOptions) => Promise<void>
  /** 为已停下或失败运行遗留的未消费输入重新发起运行，不重复写入消息事件 */
  resumeInput: (inputId: number) => Promise<void>
  /** 与 submitting 相同：chat 请求未返回时为 true，不是运行中 */
  streaming: boolean
  submitting: boolean
  /** 请求停止并记下请求时间，终态事件到达前视图 activity 为 stopping */
  stop: () => Promise<void>
  /** 读取某一轮重建出的模型请求 */
  loadTurnRequest: (runId: string, index: number) => Promise<TurnRequest>
  /** 答复审批。失败（含 409 已处理或已失效）时重新拉取详情再抛出 */
  replyApproval: (toolCallId: string, decision: ApprovalDecision) => Promise<void>
}

/**
 * 任务详情：先拉会话详情记下最大 seq，再保持一条 after_seq 订阅。
 * 断线后按最后收到的 seq 指数退避重连。发送消息只 POST /chat。
 * 运行状态只随 run 事件或重新拉取详情变化。
 * `initialSkipEmptyStream` 为旧调用方保留，订阅与发送解耦后不再使用。
 */
export function useSessionDetail(
  sessionId: string | null,
  initialSkipEmptyStream?: boolean
): UseSessionDetailResult {
  void initialSkipEmptyStream
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [files, setFiles] = useState<SessionFile[]>([])
  const [events, setEvents] = useState<SSEEventData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const loadedRef = useRef(false)
  loadedRef.current = loaded
  const [stoppingRequestedAt, setStoppingRequestedAt] = useState<number | null>(null)
  const [deltas, setDeltas] = useState<DeltaInput[]>([])
  const [streamStartedAt, setStreamStartedAt] = useState<Record<string, number>>({})
  const lastSeqRef = useRef(0)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const operationStatusRef = useRef<string | undefined>(undefined)
  operationStatusRef.current = session?.context_operation?.status
  const seenSeqRef = useRef(new Set<number>())
  const retryRef = useRef(0)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rememberSeq = useCallback((seq: number | null) => {
    if (seq == null) return
    seenSeqRef.current.add(seq)
    if (seq > lastSeqRef.current) lastSeqRef.current = seq
  }, [])

  const clearDrafts = useCallback(() => {
    setDeltas([])
    setStreamStartedAt({})
  }, [])

  const appendEvent = useCallback((ev: SSEEventData, live = true) => {
    if (String(ev.type) === 'ping') return
    if (ev.type === 'delta') {
      const data = ev.data
      const runId = data?.run_id
      const turn = data?.turn
      const attempt = data?.attempt
      const delta = data?.delta
      if (!runId || typeof turn !== 'number' || typeof attempt !== 'number' || !delta) return
      const key = streamDraftKey(runId, turn, attempt)
      setStreamStartedAt((prev) => (prev[key] != null ? prev : {...prev, [key]: Date.now()}))
      setDeltas((prev) => {
        const index = prev.findIndex((item) => (item.runId || item.run_id) === runId && item.turn === turn && item.attempt === attempt)
        if (index < 0) return [...prev, {runId, turn, attempt, delta}]
        const next = prev.slice()
        const current = next[index]
        next[index] = {...current, delta: `${current.delta ?? ''}${delta}`}
        return next
      })
      retryRef.current = 0
      return
    }
    let evToAppend: SSEEventData = ev
    if (ev.data && typeof ev.data === 'object' && ('event' in ev.data || 'type' in ev.data) && 'data' in ev.data) {
      const normalized = normalizeEvent(ev.data as { event?: string; type?: string; data?: unknown })
      if (normalized) evToAppend = normalized
    }
    if (String(evToAppend.type) === 'ping') return

    const seq = readEventSeq(evToAppend)
    if (seq != null && seenSeqRef.current.has(seq)) return
    rememberSeq(seq)
    retryRef.current = 0
    if (live) setRefreshError(null)
    setEvents((prev) => mergeBySeq(prev, [evToAppend]))

    if (evToAppend.type === 'title' && evToAppend.data && typeof (evToAppend.data as { title?: string }).title === 'string') {
      setSession((prev) =>
        prev ? { ...prev, title: (evToAppend.data as { title: string }).title } : null
      )
    }

    if (evToAppend.type === 'run') {
      const runData = evToAppend.data as RunEvent
      const targetSessionId = sessionIdRef.current
      setSession((prev) => {
        if (!prev) return null
        if (runData.status === 'running' && prev.unconsumed_inputs?.length && runData.run_id) {
          return {
            ...prev,
            status: runData.status,
            unconsumed_inputs: prev.unconsumed_inputs.filter((item) => item.run_id !== runData.run_id),
          }
        }
        return { ...prev, status: runData.status }
      })
      if (isTerminalRunStatus(runData.status)) setStoppingRequestedAt(null)
      if (
        live &&
        targetSessionId &&
        (runData.status === 'cancelled' || runData.status === 'interrupted' || runData.status === 'failed')
      ) {
        void sessionApi
          .getSessionDetail(targetSessionId, lastSeqRef.current)
          .then((detail) => {
            if (sessionIdRef.current !== targetSessionId) return
            setSession((prev) => (prev ? { ...prev, unconsumed_inputs: detail.unconsumed_inputs } : prev))
          })
          .catch(() => undefined)
      }
    }
  }, [rememberSeq])

  const stopStream = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }
  }, [])

  const startStream = useCallback(() => {
    if (!sessionId) return
    stopStream()
    streamCleanupRef.current = sessionApi.streamEvents(
      sessionId,
      lastSeqRef.current,
      (ev) => appendEvent(ev),
      (err) => {
        if (err.name === 'AbortError') return
        clearDrafts()
        if (err.message !== 'SSE_STREAM_END') {
          console.warn('Session events stream error:', err)
        }
        streamCleanupRef.current = null
        const delay = reconnectDelayMs(retryRef.current)
        retryRef.current += 1
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          if (document.visibilityState === 'hidden') return
          if (!streamCleanupRef.current) startStream()
        }, delay)
      }
    )
  }, [sessionId, appendEvent, stopStream, clearDrafts])

  const normalizeFileList = useCallback((raw: unknown): SessionFile[] => {
    if (Array.isArray(raw)) return raw as SessionFile[]
    if (raw && typeof raw === 'object' && 'files' in raw && Array.isArray((raw as { files: unknown }).files)) {
      return (raw as { files: SessionFile[] }).files
    }
    if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
      return (raw as { data: SessionFile[] }).data
    }
    return []
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionId) return
    const targetSessionId = sessionId
    const isBackground = loadedRef.current
    if (isBackground) setRefreshing(true)
    else setError(null)
    setRefreshError(null)
    clearDrafts()
    try {
      const [detail, fileListRaw] = await Promise.all([
        sessionApi.getSessionDetail(targetSessionId),
        sessionApi.getSessionFiles(targetSessionId),
      ])
      if (sessionIdRef.current !== targetSessionId) return
      const snapshot = normalizeEvents(detail.events ?? [])
      const snapshotSeq = detail.last_seq ?? snapshot.reduce((max, ev) => Math.max(max, readEventSeq(ev) ?? 0), 0)
      for (const ev of snapshot) rememberSeq(readEventSeq(ev))
      lastSeqRef.current = Math.max(lastSeqRef.current, snapshotSeq)
      setEvents((prev) => mergeBySeq(snapshot, prev))
      setSession((prev) =>
        prev && lastSeqRef.current > snapshotSeq ? { ...detail, status: prev.status, title: prev.title } : detail
      )
      setFiles(normalizeFileList(fileListRaw))
      setLoaded(true)
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return
      const err = e instanceof Error ? e : new Error('加载失败')
      if (isBackground) setRefreshError(err.message || '刷新失败')
      else setError(err)
    } finally {
      if (sessionIdRef.current === targetSessionId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [sessionId, normalizeFileList, rememberSeq, clearDrafts])

  const refreshFiles = useCallback(async () => {
    if (!sessionId) return
    const targetSessionId = sessionId
    setRefreshing(true)
    setRefreshError(null)
    try {
      const fileListRaw = await sessionApi.getSessionFiles(targetSessionId)
      if (sessionIdRef.current !== targetSessionId) return
      setFiles(normalizeFileList(fileListRaw))
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return
      setRefreshError(e instanceof Error ? e.message : '刷新成果列表失败')
    } finally {
      if (sessionIdRef.current === targetSessionId) setRefreshing(false)
    }
  }, [sessionId, normalizeFileList])

  useEffect(() => {
    lastSeqRef.current = 0
    seenSeqRef.current = new Set()
    retryRef.current = 0
    setLoaded(false)
    setRefreshing(false)
    setRefreshError(null)
    setSubmitting(false)
    setStoppingRequestedAt(null)
    setEvents([])
    setDeltas([])
    setStreamStartedAt({})
    if (!sessionId) {
      setLoading(false)
      setSession(null)
      setFiles([])
      setError(null)
      return
    }
    setLoading(true)
    refresh()
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionId || !loaded) return
    let hidden = document.visibilityState === 'hidden'
    if (!hidden) startStream()
    const sync = () => {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden === hidden) return
      hidden = nowHidden
      if (nowHidden) {
        stopStream()
        clearDrafts()
        return
      }
      startStream()
    }
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      stopStream()
    }
  }, [sessionId, loaded, startStream, stopStream, clearDrafts])

  // 压缩状态不进运行事件。只在压缩进行中轮询；通知或切回页面时核对一次。
  useEffect(() => {
    if (!sessionId || !loaded) return
    let cancelled = false
    let reading = false
    let timer: number | undefined
    const follow = (status?: string) => {
      if (status === 'compacting') {
        if (timer === undefined) timer = window.setInterval(() => { void check() }, 3000)
        return
      }
      if (timer !== undefined) { window.clearInterval(timer); timer = undefined }
    }
    const check = async () => {
      if (cancelled || reading || document.visibilityState === 'hidden') return
      reading = true
      try {
        const detail = await sessionApi.getSessionDetail(sessionId, lastSeqRef.current)
        if (!cancelled) {
          for (const event of normalizeEvents(detail.events ?? [])) appendEvent(event, false)
          setSession((prev) => {
            if (!prev) return prev
            const next = {
              context_operation: detail.context_operation,
              context_config: detail.context_config,
              unconsumed_inputs: detail.unconsumed_inputs,
              model_id: detail.model_id,
              reasoning: detail.reasoning,
              run_model: detail.run_model,
              run_reasoning: detail.run_reasoning,
            }
            const unchanged = prev.model_id === next.model_id && prev.reasoning === next.reasoning
              && prev.run_model === next.run_model && prev.run_reasoning === next.run_reasoning
              && prev.context_operation?.status === next.context_operation?.status
              && prev.context_operation?.started_at === next.context_operation?.started_at
              && JSON.stringify(prev.context_config) === JSON.stringify(next.context_config)
              && JSON.stringify(prev.unconsumed_inputs ?? []) === JSON.stringify(next.unconsumed_inputs ?? [])
            return unchanged ? prev : {...prev, ...next}
          })
          follow(detail.context_operation?.status)
          setRefreshError(null)
        }
      } catch (e) {
        if (!cancelled && loadedRef.current) {
          setRefreshError(e instanceof Error ? e.message : '后台刷新失败')
        }
      }
      finally { reading = false }
    }
    follow(operationStatusRef.current)
    const onFocus = () => { void check() }
    const unsubscribe = subscribeCatalog((hint) => {
      if (hint.kind === 'session' && hint.id === sessionId) void check()
    })
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; unsubscribe(); if (timer !== undefined) window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [sessionId, loaded, appendEvent])

  const sendMessage = useCallback(
    async (message: string, attachmentIds: string[], options?: SendOptions) => {
      void options?.retry
      if (!sessionId) return
      setSubmitting(true)
      try {
        await sendRecoverably(`session:${sessionId}`, sessionId, {
          message,
          attachments: attachmentIds,
          mode: options?.mode ?? 'normal',
          image_mode: options?.image_mode ?? 'auto',
          skill: options?.skill,
          knowledge_references: options?.knowledge_references,
          execute_plan: options?.execute_plan,
          ...(options?.model && options?.reasoning ? {model: options.model, reasoning: options.reasoning} : {}),
        })
      } catch (e) {
        await refresh()
        throw e
      } finally {
        setSubmitting(false)
      }
    },
    [sessionId, refresh]
  )

  const stop = useCallback(async () => {
    if (!sessionId) return
    setStoppingRequestedAt(Date.now())
    try {
      const stopped = await sessionApi.stopSession(sessionId)
      if (!stopped) setStoppingRequestedAt(null)
    } catch (e) {
      setStoppingRequestedAt(null)
      throw e
    }
  }, [sessionId])

  const resumeInput = useCallback(
    async (inputId: number) => {
      if (!sessionId) return
      setSubmitting(true)
      try {
        await sessionApi.resumeInput(sessionId, inputId)
        await refresh()
      } catch (e) {
        await refresh()
        throw e
      } finally {
        setSubmitting(false)
      }
    },
    [sessionId, refresh]
  )

  const replyApproval = useCallback(
    async (toolCallId: string, decision: ApprovalDecision) => {
      if (!sessionId) return
      try {
        await sessionApi.replyApproval(sessionId, toolCallId, decision)
      } catch (e) {
        await refresh()
        throw e
      }
    },
    [sessionId, refresh]
  )

  const loadTurnRequest = useCallback(
    (runId: string, index: number) => {
      if (!sessionId) return Promise.reject(new Error('没有会话'))
      return sessionApi.getTurnRequest(sessionId, runId, index)
    },
    [sessionId]
  )

  const view = useMemo(() => {
    if (!sessionId || !session) return null
    return projectSession({
      id: sessionId,
      title: session.title,
      runs: session.runs,
      contextConfig: session.context_config,
      events,
      stoppingRequestedAt,
      deltas,
      streamStartedAt,
    })
  }, [sessionId, session, events, stoppingRequestedAt, deltas, streamStartedAt])

  return {
    session,
    files,
    events,
    view,
    loading,
    error,
    refreshing,
    refreshError,
    refresh,
    refreshFiles,
    sendMessage,
    resumeInput,
    streaming: submitting,
    submitting,
    stop,
    loadTurnRequest,
    replyApproval,
  }
}
