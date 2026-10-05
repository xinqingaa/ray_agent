'use client'

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {toast} from 'sonner'
import {Folder, PanelRightOpen, Pencil} from 'lucide-react'
import {MemoryIcon} from '@/components/nav-icons'
import Link from 'next/link'
import {ProjectMemoryPanel} from '@/components/project-memory-panel'
import {ChatInput} from '@/components/chat-input'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {DeveloperView} from '@/components/developer/developer-view'
import {ContextRing} from '@/components/run/context-ring'
import {PlanExecuteBar} from '@/components/run/run-end-bar'
import {PlanBar} from '@/components/run/plan-bar'
import {UserMessage} from '@/components/run/messages'
import {RUN_INPUT_HINT, RunStatus} from '@/components/run/run-status'
import {RunStatusBar} from '@/components/run/status-bar'
import {Timeline, type TimelineHandlers} from '@/components/run/timeline-item'
import {downloadSessionFile, tabForFamily, Workbench, type WorkbenchTab} from '@/components/workbench/workbench'
import {VNCOverlay} from '@/components/vnc-overlay'
import {Button} from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {useSessionDetail} from '@/hooks/use-session-detail'
import {useSessions} from '@/hooks/use-sessions'
import {useIsMobile} from '@/hooks/use-mobile'
import {sessionApi} from '@/lib/api/session'
import {createProjectRefreshWatcher} from '@/lib/project-refresh'
import {readDraft, writeDraft} from '@/lib/drafts'
import {normalizeEvents} from '@/lib/session-events'
import {canExecutePlan} from '@/lib/session-projection'
import {ApiError} from '@/lib/api/fetch'
import type {FileInfo} from '@/lib/api/types'
import type {FileView, TimelineItem, ToolCallView, ToolFamily} from '@/lib/session-view'

export interface SessionDetailViewProps {
  sessionId: string
}

type ApprovalSubmitting = {callId: string; decision: 'approve' | 'reject'}

/** 工作台可查看的调用；等待审批的调用还没有执行，不进入工作台 */
function collectCalls(items: TimelineItem[]): ToolCallView[] {
  const calls: ToolCallView[] = []
  for (const item of items) {
    if (item.kind === 'tools') calls.push(...item.calls)
    else if (item.kind === 'approval' && item.status !== 'pending') calls.push(item.call)
  }
  return calls
}

function pendingApprovalIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.kind === 'approval' && item.status === 'pending') ids.add(item.call.callId)
  }
  return ids
}

function latestCompactionId(items: TimelineItem[] | undefined): string | null {
  if (!items) return null
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'compaction') return items[i].id
  }
  return null
}

function lastOf(calls: ToolCallView[], family: ToolFamily): ToolCallView | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].family === family) return calls[i]
  }
  return null
}

export function SessionDetailView({
  sessionId,
}: SessionDetailViewProps) {
  const isMobile = useIsMobile()
  const {sessions, patchSession, setCompactingSessionId, setWaitKind} = useSessions()
  const {
    session,
    view,
    events,
    loading,
    error,
    refresh,
    sendMessage,
    submitting,
    stop,
    loadTurnRequest,
    replyApproval,
  } = useSessionDetail(sessionId)
  const [memoryOpen,setMemoryOpen]=useState(false)
  const [outgoing, setOutgoing] = useState<{text: string; userCount: number; endCount: number; echo?: boolean} | null>(null)
  const [hiddenRunIds, setHiddenRunIds] = useState<string[]>([])
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([])
  const [retrying, setRetrying] = useState<{text: string; knownUserIds: string[]; fromRunId: string} | null>(null)
  const projectsEnabled = true
  const [projectRefreshSignal, setProjectRefreshSignal] = useState(0)
  const projectRefreshRef = useRef<ReturnType<typeof createProjectRefreshWatcher> | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalSubmitting | null>(null)
  const [localCompacting, setCompacting] = useState(false)
  const [compactAnchor, setCompactAnchor] = useState<string | null>(null)
  const compactArmed = useRef(false)
  const compacting = localCompacting || session?.context_operation?.status === 'compacting'

  const [mode, setMode] = useState<'conversation' | 'developer'>('conversation')
  const [pinnedCallId, setPinnedCallId] = useState<string | null>(null)
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [workbenchRendered, setWorkbenchRendered] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamedTitle, setRenamedTitle] = useState<{sessionId: string; title: string; previousTitle: string} | null>(null)
  const [tab, setTab] = useState<WorkbenchTab>('files')
  const [tabForId, setTabForId] = useState<string | null>(null)
  const [highlightFileId, setHighlightFileId] = useState<string | null>(null)
  const [vncOpen, setVncOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const sessionStatus = view?.status
  const displayTitle = renamedTitle?.sessionId === sessionId && view?.title === renamedTitle.previousTitle
    ? renamedTitle.title : view?.title || '新任务'
  useEffect(() => {
    const items = view?.timeline ?? []
    const retrySettled = retrying != null && items.some((item) => item.runId && item.runId !== retrying.fromRunId && item.kind !== 'user' && item.kind !== 'protection')
    const holdRunning = outgoing != null || (retrying != null && !retrySettled)
    const status = holdRunning ? 'running' : sessionStatus
    if (!status || status === 'idle') return
    const item = sessions.find((session) => session.session_id === sessionId)
    if (item?.status === status) return
    patchSession(sessionId, {status})
  }, [sessionId, sessionStatus, sessions, patchSession, outgoing, retrying, view?.timeline])
  useEffect(() => {
    if (!view) return
    const retrySettled = retrying != null && view.timeline.some((item) => item.runId && item.runId !== retrying.fromRunId && item.kind !== 'user' && item.kind !== 'protection')
    const holdRunning = outgoing != null || (retrying != null && !retrySettled)
    if (holdRunning || view.status !== 'waiting') {
      setWaitKind(sessionId, null)
      return
    }
    setWaitKind(sessionId, view.activeRun?.activity.kind === 'waiting_approval' ? 'approval' : 'reply')
  }, [sessionId, view, outgoing, retrying, setWaitKind])

  useEffect(() => {
    if (!compacting) {
      setCompactingSessionId(current => current === sessionId ? null : current)
      return
    }
    setCompactingSessionId(sessionId)
    return () => setCompactingSessionId(current => current === sessionId ? null : current)
  }, [compacting, sessionId, setCompactingSessionId])

  useEffect(() => {
    if (!compacting) {
      compactArmed.current = false
      return
    }
    if (compactArmed.current) return
    compactArmed.current = true
    setCompactAnchor(latestCompactionId(view?.timeline))
  }, [compacting, view?.timeline])

  useEffect(() => {
    if (workbenchOpen) {
      const frame = window.requestAnimationFrame(() => setWorkbenchRendered(true))
      return () => window.cancelAnimationFrame(frame)
    }
    const timeout = window.setTimeout(() => setWorkbenchRendered(false), 230)
    return () => window.clearTimeout(timeout)
  }, [workbenchOpen])

  const calls = useMemo(() => collectCalls(view?.timeline ?? []), [view])
  const pendingApprovals = useMemo(() => pendingApprovalIds(view?.timeline ?? []), [view])
  // 请求返回后仍保持“提交中”，直到结论事件到达、卡片不再是 pending
  const approvalSubmitting = approvalRequest && pendingApprovals.has(approvalRequest.callId) ? approvalRequest : null
  const waitingApproval = view?.activeRun?.activity.kind === 'waiting_approval'
  const latest = calls.length > 0 ? calls[calls.length - 1] : null
  const pin = pinnedCallId && calls.some((call) => call.callId === pinnedCallId) ? pinnedCallId : null
  const focus = pin ? calls.find((call) => call.callId === pin) ?? latest : latest
  const following = pin == null
  const focusId = focus?.callId ?? null
  const shellCall = focus?.family === 'shell' ? focus : lastOf(calls, 'shell')
  const browserCall = focus?.family === 'browser' ? focus : lastOf(calls, 'browser')
  const run = view && view.runs.length > 0 ? view.runs[view.runs.length - 1] : null

  if (focusId !== tabForId) {
    setTabForId(focusId)
    if (focus && tab !== 'project') setTab(tabForFamily(focus.family))
  }

  const projectBindable = (view?.runs.length ?? 0) === 0 && (view?.status ?? 'idle') === 'idle'


  useEffect(() => {
    const watcher = createProjectRefreshWatcher(() => setProjectRefreshSignal((n) => n + 1))
    projectRefreshRef.current = watcher
    return () => {watcher.dispose(); projectRefreshRef.current = null}
  }, [sessionId])

  useEffect(() => {
    if (view?.project?.available) projectRefreshRef.current?.observe(events)
  }, [events, view?.project?.available])

  useEffect(() => {
    setOutgoing(null)
    setHiddenRunIds([])
    setHiddenUserIds([])
    setRetrying(null)
  }, [sessionId])

  useEffect(() => {
    if (!outgoing) return
    const items = view?.timeline ?? []
    const count = items.filter((item) => item.kind === 'user').length
    const endCount = items.filter((item) => item.kind === 'run_end').length
    if (count > outgoing.userCount && (view?.activeRun || endCount > outgoing.endCount)) setOutgoing(null)
  }, [outgoing, view?.activeRun, view?.timeline])

  const deliver = useCallback(async (message: string, attachmentIds: string[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string; echo?: boolean}) => {
    const items = view?.timeline ?? []
    const userCount = items.filter((item) => item.kind === 'user').length
    const endCount = items.filter((item) => item.kind === 'run_end').length
    setOutgoing({text: message, userCount, endCount, echo: options?.echo !== false})
    try {
      await sendMessage(message, attachmentIds, {mode: options?.mode, model: options?.model, reasoning: options?.reasoning})
    } catch (err) {
      setOutgoing(null)
      throw err
    }
  }, [sendMessage, view?.timeline])

  useEffect(() => {
    if (!retrying) return
    const items = view?.timeline ?? []
    const extra = items.filter((item) => item.kind === 'user' && item.text === retrying.text && !retrying.knownUserIds.includes(item.id))
    if (extra.length) {
      setHiddenUserIds((prev) => {
        const ids = extra.map((item) => item.id).filter((id) => !prev.includes(id))
        return ids.length ? [...prev, ...ids] : prev
      })
    }
    const echoedRuns = new Set(extra.map((item) => item.runId).filter((id): id is string => !!id))
    const outcome = items.some((item) => item.runId && echoedRuns.has(item.runId) && item.kind !== 'user')
    if (outcome) setRetrying(null)
  }, [retrying, view?.timeline])

  useEffect(() => {
    if (!stickRef.current || vncOpen) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({top: el.scrollHeight, behavior: 'auto'})
  }, [view?.timeline.length, view?.status, view?.streaming?.text, vncOpen, compacting, outgoing])

  const handleCompact = useCallback(async () => {
    if (compacting) return
    compactArmed.current = true
    setCompactAnchor(latestCompactionId(view?.timeline))
    setCompacting(true)
    const scope = `session:${sessionId}`
    const beforeSeq = Math.max(session?.last_seq ?? 0, ...events.map((event) => {
      const data = event.data as {seq?: number}
      return data.seq ?? 0
    }))
    writeDraft(scope, {compactionAfterSeq: beforeSeq})
    try {
      const result = await sessionApi.compact(sessionId)
      writeDraft(scope, {compactionAfterSeq: undefined})
      if (result.status === 'skipped') toast.message(result.message)
      else toast.success(result.message)
      await refresh()
    } catch (err) {
      // 超时/断连后读取已提交事件和临时状态，不再发出第二次 compact。
      try {
        const detail = await sessionApi.getSessionDetail(sessionId)
        const records = normalizeEvents(detail.events).filter((event) => {
          const data = event.data as Record<string, unknown>
          return String(event.type) === 'compact' && data.trigger === 'manual' && Number(data.seq) > beforeSeq
        })
        if (records.length === 1) {
          const data = records[0].data as Record<string, unknown>
          const before = (data.before_estimate as {total?: number})?.total
          const after = (data.after_estimate as {total?: number})?.total
          writeDraft(scope, {compactionAfterSeq: undefined})
          toast.success(before != null && after != null && after >= before ? '已摘要，估算空间未减少' : '已确认上下文摘要完成')
        } else if (detail.context_operation?.status === 'compacting') {
          toast.message('仍在压缩，请等待操作完成；不会自动重试')
        } else {
          writeDraft(scope, {compactionAfterSeq: undefined})
          toast.error(err instanceof Error ? err.message : '压缩失败，请核对时间线后再试')
        }
        await refresh()
      } catch {
        toast.error('暂时无法核对压缩结果，请恢复连接后查看时间线；不会自动重试')
      }
    } finally { setCompacting(false) }
  }, [compacting, events, refresh, session?.last_seq, sessionId, view?.timeline])

  useEffect(() => {
    if (localCompacting || session?.context_operation?.status === 'compacting') return
    const scope = `session:${sessionId}`
    const after = readDraft(scope).compactionAfterSeq
    if (after == null) return
    const records = events.filter((event) => {
      const data = event.data as Record<string, unknown>
      return String(event.type) === 'compact' && data.trigger === 'manual' && Number(data.seq) > after
    })
    if (records.length === 1) {
      writeDraft(scope, {compactionAfterSeq: undefined})
      toast.success('已确认上下文摘要完成，请查看压缩记录')
    }
  }, [events, localCompacting, session?.context_operation?.status, sessionId])

  const handleStop = useCallback(async () => {
    try {
      await stop()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止失败')
    }
  }, [stop])

  const handleSend = useCallback(async (message: string, uploaded: FileInfo[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string}) => {
    try {
      await deliver(message, uploaded.map((file) => file.id), options)
    } catch (err) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error(err.msg)
      } else {
        toast.error(err instanceof Error ? err.message : '发送失败，请重试')
      }
      throw err
    }
  }, [deliver])

  const handleApproval = useCallback(async (callId: string, decision: 'approve' | 'reject') => {
    if (approvalSubmitting) return
    setApprovalRequest({callId, decision})
    try {
      await replyApproval(callId, decision === 'approve' ? 'approve' : 'deny')
    } catch (err) {
      setApprovalRequest(null)
      toast.error(err instanceof Error ? err.message : '提交审批失败，请重试')
    }
  }, [approvalSubmitting, replyApproval])

  const downloadOne = useCallback(async (file: FileView) => {
    try {
      await downloadSessionFile(file)
      toast.success(`已下载「${file.filename}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败')
    }
  }, [])

  const downloadAll = useCallback(async (files: FileView[]) => {
    for (const file of files) {
      try {
        await downloadSessionFile(file)
      } catch (err) {
        toast.error(`「${file.filename}」下载失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }
    }
    if (files.length > 0) toast.success(`已下载 ${files.length} 个文件`)
  }, [])

  const handlers = useMemo<TimelineHandlers>(() => ({
    projectId: view?.project?.id,
    sessionId: view?.id,
    selectedCallId: focus?.callId ?? null,
    onOpenCall: (callId) => {
      setPinnedCallId(callId)
      setWorkbenchOpen(true)
    },
    onPreviewFile: (file) => {
      setHighlightFileId(file.id)
      setTab('files')
      setWorkbenchOpen(true)
    },
    onDownloadFile: (file) => {
      void downloadOne(file)
    },
    onDownloadAll: (files) => {
      void downloadAll(files)
    },
    streamingItemId: view?.streamingItemId ?? null,
    retryRunId: (() => {
      const latest = [...(view?.timeline ?? [])].reverse().find((item) => item.kind === 'run_end' && item.status === 'failed' && item.retryText && item.runId)
      return latest?.runId && !hiddenRunIds.includes(latest.runId) ? latest.runId : ''
    })(),
    onRetry: view?.activeRun || submitting || retrying ? undefined : (text, runId) => {
      const knownUserIds = (view?.timeline ?? []).filter((item) => item.kind === 'user').map((item) => item.id)
      setHiddenRunIds((prev) => prev.includes(runId) ? prev : [...prev, runId])
      setRetrying({text, knownUserIds, fromRunId: runId})
      void deliver(text, [], {echo: false}).catch((err: unknown) => {
        setHiddenRunIds((prev) => prev.filter((id) => id !== runId))
        setRetrying((current) => current?.fromRunId === runId ? null : current)
        toast.error(err instanceof Error ? err.message : '重试失败')
      })
    },
    onApprove: (callId) => void handleApproval(callId, 'approve'),
    onReject: (callId) => void handleApproval(callId, 'reject'),
    approvalSubmitting,
  }), [view?.id, view?.project?.id, view?.timeline, focus?.callId, view?.activeRun, view?.streamingItemId, submitting, retrying, hiddenRunIds, downloadOne, downloadAll, deliver, handleApproval, approvalSubmitting])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (loading && !view) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">正在读取对话</p>
      </div>
    )
  }

  if (error && !view) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-state-failed">{error.message}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-sm text-sm text-signal underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          重新读取
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">未找到该任务</p>
      </div>
    )
  }

  const activity = view.activeRun?.activity
  const activityKind = activity?.kind
  const userCount = view.timeline.filter((item) => item.kind === 'user').length
  const echoed = outgoing != null && userCount > outgoing.userCount
  const endCount = view.timeline.filter((item) => item.kind === 'run_end').length
  const visibleTimeline = view.timeline.filter((item) => {
    if (item.kind === 'run_end' && item.runId && hiddenRunIds.includes(item.runId)) return false
    if (item.kind === 'user' && (hiddenUserIds.includes(item.id) || (retrying != null && item.text === retrying.text && !retrying.knownUserIds.includes(item.id)))) return false
    return true
  })
  const hideEndId = outgoing != null && endCount <= outgoing.endCount
    ? [...visibleTimeline].reverse().find((item) => item.kind === 'run_end')?.id ?? null
    : null
  const shownTimeline = hideEndId ? visibleTimeline.filter((item) => item.id !== hideEndId) : visibleTimeline
  const lastItem = shownTimeline[shownTimeline.length - 1]
  const tailQuiet = !lastItem || lastItem.kind === 'user' || lastItem.kind === 'protection'
  const retrySettled = retrying != null && view.timeline.some((item) => item.runId && item.runId !== retrying.fromRunId && item.kind !== 'user' && item.kind !== 'protection')
  const pendingSend = outgoing != null || (retrying != null && !retrySettled)
  const showOptimistic = outgoing != null && outgoing.echo !== false && !echoed && !submitting
  const waitingReply = activityKind === 'waiting_reply'
  const pauseMode = waitingReply ? false : activityKind === 'stopping' ? 'stopping' : (outgoing || submitting || (retrying != null && !retrySettled) || view.status === 'running' || waitingApproval) ? 'ready' as const : false

  const placeholder = waitingApproval
    ? RUN_INPUT_HINT.approval
    : view.status === 'waiting'
    ? RUN_INPUT_HINT.reply
    : view.status === 'running'
      ? RUN_INPUT_HINT.running
      : RUN_INPUT_HINT.idle

  const showPlanExecute = canExecutePlan(view)

  const workbench = (
    <Workbench
      sessionId={sessionId}
      focus={focus}
      following={following}
      shellCall={shellCall}
      browserCall={browserCall}
      files={view.files}
      tab={tab}
      onTab={setTab}
      highlightFileId={highlightFileId}
      onFollowLatest={() => setPinnedCallId(null)}
      onClose={() => setWorkbenchOpen(false)}
      onOpenVnc={browserCall ? () => setVncOpen(true) : undefined}
      project={view.project}
      projectRefreshSignal={projectRefreshSignal}
      className={isMobile ? undefined : 'h-full w-[min(40vw,26rem)] shrink-0 border-l'}
    />
  )

  return (
    <>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1">
              <div className="flex min-w-0 items-center gap-1">
              <h1 className="min-w-0 truncate text-sm font-medium" title={displayTitle}>{displayTitle}</h1>
              <Button type="button" variant="ghost" size="icon-xs" className="size-7 shrink-0 text-muted-foreground"
                title="重命名会话" aria-label="重命名会话" onClick={() => setRenameOpen(true)}>
                <Pencil className="size-3.5"/>
              </Button>
              <RunStatus place="headline" status={run?.status} compacting={compacting}/>
              </div>
              {view.project && (
                <div className="order-first flex min-w-0 items-center gap-1">
                  <Link href={`/projects/${view.project.id}`} className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground" title={view.project.reason ?? view.project.name}>
                    <Folder className="size-3.5 shrink-0"/><span className="truncate">
                    {view.project.name}
                    {!view.project.available && view.project.reason ? ` · ${view.project.reason}` : ''}
                  </span></Link>
                </div>
              )}
            </div>
            <div role="group" aria-label="会话视图" className="flex shrink-0 rounded-md border p-0.5">
              <button
                type="button"
                aria-pressed={mode === 'conversation'}
                onClick={() => setMode('conversation')}
                className={`rounded-sm px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'conversation' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                对话
              </button>
              <button
                type="button"
                aria-pressed={mode === 'developer'}
                onClick={() => setMode('developer')}
                className={`rounded-sm px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'developer' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                开发者
              </button>
            </div>
            {view.project && (
              <Button type="button" variant="ghost" size="icon-xs" className="size-7 shrink-0 text-muted-foreground"
                title="项目记忆" aria-label="项目记忆" onClick={() => setMemoryOpen(true)}>
                <MemoryIcon className="size-4"/>
              </Button>
            )}
            {!workbenchOpen && (
              <Button type="button" variant="ghost" size="icon-xs" className="size-7 shrink-0"
                title="打开工作台" aria-label="打开工作台" onClick={() => setWorkbenchOpen(true)}>
                <PanelRightOpen className="size-4"/>
              </Button>
            )}
          </header>
          {view.project && <ProjectMemoryPanel projectId={view.project.id} sessionId={sessionId} open={memoryOpen} onClose={()=>setMemoryOpen(false)}/>}

          {mode === 'conversation' ? (
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
                {shownTimeline.length === 0 && !showOptimistic && (
                  <p className="py-8 text-center text-meta text-faint">
                    这里会显示你的消息、工具操作和最终回复。在下方输入任务后开始。
                  </p>
                )}
                <Timeline items={shownTimeline} handlers={handlers}/>
                {showOptimistic && outgoing ? <UserMessage text={outgoing.text}/> : null}
                <RunStatus
                  place="timeline"
                  compacting={compacting && latestCompactionId(view.timeline) === compactAnchor}
                  pendingSend={pendingSend}
                  activity={activityKind}
                  streaming={!!view.streaming?.text}
                  running={view.activeRun?.status === 'running'}
                  tailQuiet={tailQuiet}
                />
                {showPlanExecute && (
                  <PlanExecuteBar
                    disabled={submitting}
                    onExecute={() => {
                      void deliver('按计划执行', [], {mode: 'normal'}).catch((err: unknown) => {
                        if (err instanceof ApiError && err.code === 409) {
                          toast.error(err.msg)
                          return
                        }
                        toast.error(err instanceof Error ? err.message : '发送失败')
                      })
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DeveloperView view={view} loadTurnRequest={loadTurnRequest} className="mx-auto w-full max-w-4xl"/>
            </div>
          )}

          <div className="shrink-0 border-t bg-background px-3 py-3">
            <div className="mx-auto w-full max-w-3xl">
              {mode === 'conversation' && (
                <PlanBar plan={view.plan} runStatus={view.status === 'idle' ? null : view.status} className="mb-2"/>
              )}
              <RunStatusBar run={pendingSend && !view.activeRun ? null : view.activeRun} className="mb-2"/>
              <ChatInput
                sessionId={sessionId}
                onSend={handleSend}
                pause={pauseMode}
                onPause={() => void handleStop()}
                disabled={submitting || waitingApproval}
                placeholder={placeholder}
                savedModel={session?.model_id}
                savedReasoning={session?.reasoning}
                runModel={session?.run_model}
                runReasoning={session?.run_reasoning}
                accessory={(context) => <ContextRing usage={view.usage} commandContext={context}/>}
                projectsEnabled={projectsEnabled}
                projectBindable={projectBindable}
                selectedProject={view.project}
                commandHost={{
                  hasSession: true,
                  hasRuns: view.runs.length > 0,
                  runStatus: view.status,
                  waitingApproval,
                  waitingReply: view.activeRun?.activity.kind === 'waiting_reply',
                  submitting,
                  compacting,
                  projectsEnabled,
                  projectBindable,
                  actions: {compact: () => { void handleCompact() }},
                }}
              />
            </div>
          </div>
        </div>

        {!isMobile && (
          <div aria-hidden={!workbenchOpen} inert={!workbenchOpen}
            className={`h-full shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-in-out motion-reduce:transition-none ${workbenchOpen ? 'w-[min(40vw,26rem)]' : 'w-0'}`}>
            {(workbenchOpen || workbenchRendered) && workbench}
          </div>
        )}
      </div>

      {isMobile && (
        <Sheet open={workbenchOpen} onOpenChange={setWorkbenchOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md data-[state=closed]:duration-[220ms] data-[state=open]:duration-[220ms]" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>操作详情</SheetTitle>
              <SheetDescription>查看工具结果、终端、浏览器和文件</SheetDescription>
            </SheetHeader>
            {workbench}
          </SheetContent>
        </Sheet>
      )}

      <RenameSessionDialog sessionId={sessionId} currentTitle={displayTitle} open={renameOpen}
        onOpenChange={setRenameOpen}
        onSaved={(title) => {
          setRenamedTitle({sessionId, title, previousTitle: view.title})
          patchSession(sessionId, {title})
        }}/>
      {vncOpen && <VNCOverlay sessionId={sessionId} onClose={() => setVncOpen(false)}/>}
    </>
  )
}
