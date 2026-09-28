'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionApi } from '@/lib/api/session'
import { normalizeEvent, normalizeEvents, trimToLastUserMessage } from '@/lib/session-events'
import type { RunEvent, SessionDetail, SSEEventData, SessionFile } from '@/lib/api/types'
import { isRunSettled } from '@/lib/api/types'

export type UseSessionDetailResult = {
  session: SessionDetail | null
  files: SessionFile[]
  events: SSEEventData[]
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
  refreshFiles: () => Promise<void>
  sendMessage: (message: string, attachmentIds: string[], options?: { retry?: boolean }) => Promise<void>
  streaming: boolean
}

const RECONNECT_DELAY_MS = 1000

function eventSeq(ev: SSEEventData): number | undefined {
  const seq = (ev.data as { seq?: unknown } | undefined)?.seq
  return typeof seq === 'number' ? seq : undefined
}

/**
 * 任务详情：拉取会话详情与文件列表，按 seq 订阅会话事件。
 * 发送消息只提交 chat，事件统一由订阅流送达；断线后从最后一个 seq 续传。
 * `initialSkipEmptyStream` 为旧调用方保留，订阅与发送解耦后不再需要。
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
  const [streaming, setStreaming] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const lastSeqRef = useRef(0)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRunIdRef = useRef<string | null>(null)
  // run_id → 最近一次进入 waiting 或终态的事件 seq，用于判断 chat 受理前运行是否已停下
  const settledRunsRef = useRef<Map<string, number>>(new Map())

  const appendEvent = useCallback((ev: SSEEventData) => {
    let evToAppend = ev
    if (ev.data && typeof ev.data === 'object' && ('event' in ev.data || 'type' in ev.data) && 'data' in ev.data) {
      const normalized = normalizeEvent(ev.data as { event?: string; type?: string; data?: unknown })
      if (normalized) evToAppend = normalized
    }

    const seq = eventSeq(evToAppend)
    if (seq !== undefined) {
      if (seq <= lastSeqRef.current) return
      lastSeqRef.current = seq
    }

    setEvents((prev) => [...prev, evToAppend])

    if (evToAppend.type === 'title' && evToAppend.data && typeof (evToAppend.data as { title?: string }).title === 'string') {
      setSession((prev) =>
        prev ? { ...prev, title: (evToAppend.data as { title: string }).title } : null
      )
    }

    // 会话状态以运行事件为准；done/error 之后同一运行可能因待处理输入继续
    if (evToAppend.type === 'run') {
      const runData = evToAppend.data as RunEvent & { run_id?: string | null }
      setSession((prev) => (prev ? { ...prev, status: runData.status } : null))
      if (runData.run_id && isRunSettled(runData.status)) {
        settledRunsRef.current.set(runData.run_id, seq ?? 0)
        if (pendingRunIdRef.current === runData.run_id) {
          pendingRunIdRef.current = null
          setStreaming(false)
        }
      }
    }
  }, [])

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
        if (err.message !== 'SSE_STREAM_END') {
          console.warn('Session events stream error:', err)
        }
        streamCleanupRef.current = null
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          if (!streamCleanupRef.current) startStream()
        }, RECONNECT_DELAY_MS)
      }
    )
  }, [sessionId, appendEvent, stopStream])

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
    setError(null)
    try {
      const [detail, fileListRaw] = await Promise.all([
        sessionApi.getSessionDetail(sessionId),
        sessionApi.getSessionFiles(sessionId),
      ])
      const snapshot = normalizeEvents(detail.events ?? [])
      const snapshotSeq = detail.last_seq ?? snapshot.reduce((max, ev) => Math.max(max, eventSeq(ev) ?? 0), 0)
      // 订阅流可能已送达快照之后的事件，保留它们
      setEvents((prev) => [...snapshot, ...prev.filter((ev) => (eventSeq(ev) ?? 0) > snapshotSeq)])
      lastSeqRef.current = Math.max(lastSeqRef.current, snapshotSeq)
      setSession((prev) =>
        prev && lastSeqRef.current > snapshotSeq ? { ...detail, status: prev.status, title: prev.title } : detail
      )
      setFiles(normalizeFileList(fileListRaw))
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e : new Error('加载失败'))
    } finally {
      setLoading(false)
    }
  }, [sessionId, normalizeFileList])

  const refreshFiles = useCallback(async () => {
    if (!sessionId) return
    try {
      const fileListRaw = await sessionApi.getSessionFiles(sessionId)
      setFiles(normalizeFileList(fileListRaw))
    } catch (e) {
      console.error('刷新文件列表失败:', e)
    }
  }, [sessionId, normalizeFileList])

  useEffect(() => {
    lastSeqRef.current = 0
    pendingRunIdRef.current = null
    settledRunsRef.current = new Map()
    setLoaded(false)
    setStreaming(false)
    setEvents([])
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

  // 详情加载后常驻订阅，覆盖运行中、等待回复、停止后的收尾事件与其他入口发起的新运行
  useEffect(() => {
    if (!sessionId || !loaded) return
    startStream()
    return () => {
      stopStream()
    }
  }, [sessionId, loaded, startStream, stopStream])

  const sendMessage = useCallback(
    async (message: string, attachmentIds: string[], options?: { retry?: boolean }) => {
      if (!sessionId) return
      if (options?.retry) {
        setEvents((prev) => trimToLastUserMessage(prev))
      }
      setStreaming(true)
      setSession((prev) => (prev ? { ...prev, status: 'running' } : null))
      try {
        const accepted = await sessionApi.chat(sessionId, { message, attachments: attachmentIds })
        if ((settledRunsRef.current.get(accepted.run_id) ?? -1) > accepted.seq) {
          setStreaming(false)
        } else {
          pendingRunIdRef.current = accepted.run_id
        }
      } catch (e) {
        setStreaming(false)
        refresh()
        throw e
      }
    },
    [sessionId, refresh]
  )

  return {
    session,
    files,
    events,
    loading,
    error,
    refresh,
    refreshFiles,
    sendMessage,
    streaming,
  }
}
