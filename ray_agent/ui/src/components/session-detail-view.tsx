import type {PlanAcceptance, WorkspaceItem} from '@/lib/api/types'

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {ArrowDown, Code2, Eye, Folder, History, Inbox, MessageCircle, PanelRight, Pencil} from '@/components/ui/icons'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {DeveloperView} from '@/components/developer/developer-view'
import {ContextRing} from '@/components/run/context-ring'
import {PlanExecuteBar} from '@/components/run/run-end-bar'
import {PlanBar} from '@/components/run/plan-bar'
import {PlanListDialog} from '@/components/run/plan-list-dialog'
import {UserMessage} from '@/components/run/messages'
import {RUN_INPUT_HINT, RunStatus} from '@/components/run/run-status'
import {Timeline, type TimelineHandlers} from '@/components/run/timeline-item'
import {downloadFileBatch, isWebPage, openPreviewTab} from '@/lib/api/preview'
import {FilePreviewDialog} from '@/components/preview/file-preview-dialog'
import {downloadSessionFile, tabForFamily, Workbench, type WorkbenchTab} from '@/components/workbench/workbench'
import {describeWorkspace} from '@/lib/workspace-state'
import {FolderPanel, type FolderPanelRef, type FolderPanelTab} from '@/components/workspace/folder-panel'
import {TaskInspector, TaskLayout, useTaskInspector} from '@/components/task-layout'
import {TopbarActions, TopbarTitle} from '@/components/sidebar-chrome'
import {FilePreview} from '@/components/preview/file-preview'
import {FileRow} from '@/components/preview/file-row'
import {RunMemoryNotice} from '@/components/run/run-memory-notice'
import {useLocation} from 'react-router'
import {cn} from '@/lib/utils'
import {Switch} from '@/components/ui/switch'
import {IconAction} from '@/components/ui/icon-action'
import {useSessionDetail} from '@/hooks/use-session-detail'
import {useSessions} from '@/hooks/use-sessions'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {memoryApi} from '@/lib/api/memory'
import {sessionApi} from '@/lib/api/session'
import {readRetryDisplay, writeRetryDisplay, retryEcho} from '@/lib/retry-display'
import {readDraft, writeDraft} from '@/lib/drafts'
import {normalizeEvents} from '@/lib/session-events'
import {canExecutePlan, planBarMode} from '@/lib/session-projection'
import {ApiError} from '@/lib/api/fetch'
import type {FileInfo, SSEEventOf} from '@/lib/api/types'
import type {FileView, TimelineItem, ToolCallView, ToolFamily} from '@/lib/session-view'

export interface SessionDetailViewProps {
  sessionId: string
  /** 工作区会话：右侧面板在文件夹与工作台之间切换，输入框随工作区状态只读 */
  workspace?: WorkspaceItem
  /** 运行结束后显示在时间线末尾的内容（如撤销本次修改）；参数是最近一次运行的 id，还没有运行时为 null */
  runFooter?: (runId: string | null) => ReactNode
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
  workspace,
  runFooter,
}: SessionDetailViewProps) {
  const {visibility} = useDeveloperMode()
  const {hash, search} = useLocation()
  const locatedDelivery = useRef('')
  const locatedSource = useRef('')
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
  const [outgoing, setOutgoing] = useState<{text: string; skillName?: string; userCount: number; endCount: number; echo?: boolean} | null>(null)
  const [hiddenRunIds, setHiddenRunIds] = useState<string[]>([])
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([])
  const [retrying, setRetrying] = useState<{text: string; knownUserIds: string[]; fromRunId: string} | null>(null)
  const [retrySessionId, setRetrySessionId] = useState<string | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalSubmitting | null>(null)
  const [localCompacting, setCompacting] = useState(false)
  const [compactAnchor, setCompactAnchor] = useState<string | null>(null)
  const compactArmed = useRef(false)
  const compacting = localCompacting || session?.context_operation?.status === 'compacting'

  const [selectedMode, setMode] = useState<'conversation' | 'developer'>('conversation')
  const mode = visibility.developerView ? selectedMode : 'conversation'
  const [developerVisited, setDeveloperVisited] = useState(false)
  const [pinnedCallId, setPinnedCallId] = useState<string | null>(null)
  const {open: workbenchOpen, setOpen: setWorkbenchOpen, floating: inspectorFloating} = useTaskInspector(workspace != null)
  const [panelView, setPanelView] = useState<FolderPanelTab | 'workbench'>(workspace ? 'folder' : 'workbench')
  const [inspectorFile, setInspectorFile] = useState<FileView | null>(null)
  const inspectorTrigger = useRef<HTMLButtonElement>(null)
  const folderPanel = useRef<FolderPanelRef>(null)
  const composer = useRef<ChatInputRef>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renamedTitle, setRenamedTitle] = useState<{sessionId: string; title: string; previousTitle: string} | null>(null)
  const [tab, setTab] = useState<WorkbenchTab>('files')
  const [tabForId, setTabForId] = useState<string | null>(null)
  const [previewedFile, setPreviewedFile] = useState<FileView | null>(null)
  const [inspectingFile, setInspectingFile] = useState(false)
  const [inspectedAtCallId, setInspectedAtCallId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const developerScrollRef = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef({conversation: 0, developer: 0})
  const stickRef = useRef(true)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const [planColumn, setPlanColumn] = useState<HTMLDivElement | null>(null)
  const [planPanelWidth, setPlanPanelWidth] = useState<number>()
  const [participateInMemory, setParticipateInMemory] = useState(true)
  const [participateBusy, setParticipateBusy] = useState(false)
  const memoryToastSeq = useRef(new Set<number>())

  useEffect(() => {
    if (!planColumn) return
    const measure = () => setPlanPanelWidth(planColumn.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(planColumn)
    return () => observer.disconnect()
  }, [planColumn])

  useLayoutEffect(() => {
    const el = mode === 'conversation' ? scrollRef.current : developerScrollRef.current
    if (el) el.scrollTop = mode === 'conversation' && stickRef.current ? el.scrollHeight : scrollPositions.current[mode]
  }, [mode, developerVisited, view?.id])

  const sessionStatus = view?.status
  const displayTitle = renamedTitle?.sessionId === sessionId && view?.title === renamedTitle.previousTitle
    ? renamedTitle.title : view?.title || '新任务'
  useEffect(() => {
    const items = view?.timeline ?? []
    const retrySettled = retrying != null && retryEcho(items, retrying).settled
    const holdRunning = outgoing != null || (retrying != null && !retrySettled)
    const status = holdRunning ? 'running' : sessionStatus === 'idle' ? 'pending' : sessionStatus
    if (!status) return
    const item = sessions.find((session) => session.session_id === sessionId)
    if (item?.status === status) return
    patchSession(sessionId, {status})
  }, [sessionId, sessionStatus, sessions, patchSession, outgoing, retrying, view?.timeline])
  useEffect(() => {
    if (!view) return
    const retrySettled = retrying != null && retryEcho(view.timeline, retrying).settled
    const holdRunning = outgoing != null || (retrying != null && !retrySettled)
    if (holdRunning || view.status !== 'waiting') {
      setWaitKind(sessionId, null)
      return
    }
    setWaitKind(sessionId, view.activeRun?.activity.kind === 'waiting_approval' ? 'approval' : 'reply')
  }, [sessionId, view, outgoing, retrying, setWaitKind])

  // 页面可见时看到了完成结果，清掉侧栏的未查看圆点；侧栏列表可能不含当前会话，按每次完成清一次
  const completedRunId = view?.status === 'completed' ? view.runs.at(-1)?.id ?? null : null
  const listedUnread = sessions.find((item) => item.session_id === sessionId)?.unread_message_count
  const clearedRun = useRef<string | null>(null)
  useEffect(() => {
    if (!completedRunId || listedUnread === 0) return
    const key = `${sessionId}:${completedRunId}:${listedUnread ?? ''}`
    const clear = () => {
      if (document.visibilityState !== 'visible' || clearedRun.current === key) return
      clearedRun.current = key
      void sessionApi.clearUnreadMessageCount(sessionId).catch(() => {clearedRun.current = null})
    }
    clear()
    document.addEventListener('visibilitychange', clear)
    return () => document.removeEventListener('visibilitychange', clear)
  }, [sessionId, completedRunId, listedUnread])

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


  const calls = useMemo(() => collectCalls(view?.timeline ?? []), [view])
  const pendingApprovals = useMemo(() => pendingApprovalIds(view?.timeline ?? []), [view])
  // 请求返回后仍保持“提交中”，直到结论事件到达、卡片不再是 pending
  const approvalSubmitting = approvalRequest && pendingApprovals.has(approvalRequest.callId) ? approvalRequest : null
  const waitingApproval = view?.activeRun?.activity.kind === 'waiting_approval'
  const visibleCalls = calls.filter(call => visibility.canInspectTool(call.family))
  const latest = visibleCalls.length > 0 ? visibleCalls[visibleCalls.length - 1] : null
  const pin = pinnedCallId && visibleCalls.some((call) => call.callId === pinnedCallId) ? pinnedCallId : null
  const focus = pin ? visibleCalls.find((call) => call.callId === pin) ?? latest : latest
  const following = pin == null && !inspectingFile
  const focusId = focus?.callId ?? null
  const shellCall = focus?.family === 'shell' ? focus : lastOf(calls, 'shell')
  const browserCall = focus?.family === 'browser' ? focus : lastOf(calls, 'browser')
  const run = view && view.runs.length > 0 ? view.runs[view.runs.length - 1] : null

  if (focusId !== tabForId) {
    setTabForId(focusId)
    if (focus && !inspectingFile) setTab(tabForFamily(focus.family))
  }



  const participation = session?.participate_in_memory
  const scopedSessionId = session?.session_id
  const workspaceId = workspace?.id
  useEffect(() => {
    if (workspaceId && scopedSessionId === sessionId) setParticipateInMemory(participation !== false)
  }, [sessionId, scopedSessionId, workspaceId, participation])

  useEffect(() => {
    if (!workspace) return
    for (const event of events) {
      if (event.type !== 'tool') continue
      const data = event.data
      const seq = data.seq
      if (seq == null || memoryToastSeq.current.has(seq)) continue
      if (data.function !== 'memory_remember' || data.status !== 'called') continue
      const result = (data as {function_result?: {success?: boolean; data?: {id?: string; version?: number}}}).function_result
      if (result?.success === false) continue
      const entry = result?.data
      const id = entry?.id
      const version = entry?.version
      if (!id || version == null) continue
      memoryToastSeq.current.add(seq)
      toast.success('已记住', {
        action: id ? {
          label: '撤销',
          onClick: () => {
            void memoryApi.patch(workspace.id, id, {action: 'undo', version})
              .catch(err => toast.error(err instanceof Error ? err.message : '撤销失败'))
          },
        } : undefined,
      })
    }
  }, [events, workspace])

  useEffect(() => {
    setOutgoing(null)
    setInspectingFile(false)
    setPreviewedFile(null)
    const saved = readRetryDisplay(sessionId)
    setHiddenRunIds(saved.hiddenRunIds)
    setHiddenUserIds(saved.hiddenUserIds)
    setRetrying(saved.pending)
    setRetrySessionId(sessionId)
    stickRef.current = true
    setAwayFromBottom(false)
  }, [sessionId])

  useEffect(() => {
    if (retrySessionId === sessionId) writeRetryDisplay(sessionId, {hiddenRunIds, hiddenUserIds, pending: retrying})
  }, [sessionId, retrySessionId, hiddenRunIds, hiddenUserIds, retrying])

  useEffect(() => {
    if (!outgoing) return
    const items = view?.timeline ?? []
    const count = items.filter((item) => item.kind === 'user').length
    const endCount = items.filter((item) => item.kind === 'run_end').length
    if (count > outgoing.userCount && (view?.activeRun || endCount > outgoing.endCount)) setOutgoing(null)
  }, [outgoing, view?.activeRun, view?.timeline])

  const deliver = useCallback(async (message: string, attachmentIds: string[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string; execute_plan?: PlanAcceptance; skill?: {id: string; version: string}; image_mode?: 'auto' | 'files'; echo?: boolean}) => {
    const items = view?.timeline ?? []
    const userCount = items.filter((item) => item.kind === 'user').length
    const endCount = items.filter((item) => item.kind === 'run_end').length
    setOutgoing({text: message, skillName: options?.skill?.id, userCount, endCount, echo: options?.echo !== false})
    try {
      await sendMessage(message, attachmentIds, {mode: options?.mode, model: options?.model, reasoning: options?.reasoning, image_mode: options?.image_mode, skill: options?.skill, execute_plan: options?.execute_plan})
    } catch (err) {
      setOutgoing(null)
      throw err
    }
  }, [sendMessage, view?.timeline])

  useEffect(() => {
    if (!retrying || retrySessionId !== sessionId) return
    const items = view?.timeline ?? []
    const echo = retryEcho(items, retrying)
    const userId = echo.userId
    if (userId) setHiddenUserIds(prev => prev.includes(userId) ? prev : [...prev, userId])
    if (echo.settled) setRetrying(null)
  }, [retrying, view?.timeline, retrySessionId, sessionId])

  useEffect(() => {
    if (!stickRef.current || mode !== 'conversation') return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({top: el.scrollHeight, behavior: 'auto'})
  }, [view?.timeline.length, view?.status, view?.streaming?.text, compacting, outgoing, mode])

  useEffect(() => {
    const content = messageContentRef.current
    const el = scrollRef.current
    if (!content || !el || mode !== 'conversation') return
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
      else setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight >= 200)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [mode, view?.id])

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
        const records = normalizeEvents(detail.events).filter((event): event is SSEEventOf<'compact'> =>
          event.type === 'compact' && event.data.trigger === 'manual' && (event.data.seq ?? 0) > beforeSeq)
        if (records.length === 1) {
          const data = records[0].data
          const before = (data.before_estimate as {total?: number}).total
          const after = (data.after_estimate as {total?: number}).total
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
    const records = events.filter((event) =>
      event.type === 'compact' && event.data.trigger === 'manual' && (event.data.seq ?? 0) > after)
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

  const handleSend = useCallback(async (message: string, uploaded: FileInfo[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string; skill?: {id: string; version: string}; image_mode?: 'auto' | 'files'}) => {
    try {
      await deliver(message, uploaded.map((file) => file.id), options)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        toast.error(err.message)
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

  const finishedSequences = useMemo(() => {
    const found = new Map<string, number>()
    for (const event of view?.events ?? []) {
      if (event.type === 'run' && event.runId && event.payload.status === 'completed') found.set(event.runId, event.seq)
    }
    return found
  }, [view?.events])
  const latestCompletedId = view?.runs.filter(run => run.status === 'completed').at(-1)?.id

  useEffect(() => {
    if (!hash) {locatedSource.current = ''; return}
    if (hash === locatedSource.current || mode !== 'conversation') return
    const match = /^#event-(\d+)$/.exec(hash)
    if (!match) return
    const runId = view?.events.find(event => event.seq === Number(match[1]))?.runId
    const node = runId ? document.getElementById(`reply-${runId}`) : null
    if (!node) return
    locatedSource.current = hash
    stickRef.current = false
    node.scrollIntoView({block: 'start'})
  }, [hash, mode, view?.events])

  useEffect(() => {
    const fileId = new URLSearchParams(search).get('delivery')
    if (!fileId) {locatedDelivery.current = ''; return}
    if (fileId === locatedDelivery.current) return
    const file = view?.files.find(item => item.id === fileId && item.source === 'delivery')
    if (!file) return
    locatedDelivery.current = fileId
    if (isWebPage(file.filename)) {
      void openPreviewTab({kind: 'attachment', id: file.id, filename: file.filename, size: file.size})
        .catch(error => toast.error(error instanceof Error ? error.message : '打开失败'))
    } else {
      setInspectorFile(file)
      setPanelView('workbench')
      setWorkbenchOpen(true)
    }
  }, [search, setWorkbenchOpen, view?.files])

  const packingFiles = useRef(false)
  const downloadAll = useCallback(async (files: FileView[]) => {
    if(packingFiles.current)return
    packingFiles.current=true
    try {await downloadFileBatch(files)} catch(error) {toast.error(error instanceof Error ? error.message : '打包失败')}
    finally {packingFiles.current=false}
  }, [])

  const handlers = useMemo<TimelineHandlers>(() => ({
    sessionId: view?.id,
    selectedCallId: focus?.callId ?? null,
    // 工作区会话的右侧面板也带工作台：点工具卡片切到工作台并选中该工具
    onOpenCall: (callId) => {
      setInspectingFile(false)
      setPinnedCallId(callId)
      setPanelView('workbench')
      setInspectorFile(null)
      setWorkbenchOpen(true)
    },
    onPreviewFile: (file) => {
      if (isWebPage(file.filename)) void openPreviewTab({kind: 'attachment', id: file.id, filename: file.filename, size: file.size}).catch(error => toast.error(error instanceof Error ? error.message : '打开失败'))
      else if (file.source === 'delivery') {
        setInspectorFile(file)
        setPanelView('workbench')
        setWorkbenchOpen(true)
      } else setPreviewedFile(file)
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
      const pending = {text, knownUserIds, fromRunId: runId}
      writeRetryDisplay(sessionId, {hiddenRunIds: [...hiddenRunIds, runId], hiddenUserIds, pending})
      setRetrying(pending)
      const source = view?.timeline.find(item => item.kind === 'user' && item.runId === runId)
      const attachmentIds = source?.kind === 'user' ? source.attachments.map(file => file.id) : []
      const mode = view?.runs.find(run => run.id === runId)?.mode ?? 'normal'
      void deliver(text, attachmentIds, {echo: false, mode}).catch((err: unknown) => {
        setHiddenRunIds((prev) => prev.filter((id) => id !== runId))
        setRetrying((current) => current?.fromRunId === runId ? null : current)
        toast.error(err instanceof Error ? err.message : '重试失败')
      })
    },
    onApprove: (callId) => void handleApproval(callId, 'approve'),
    onReject: (callId) => void handleApproval(callId, 'reject'),
    approvalSubmitting,
    showRunReferences: workspace != null,
    workspaceId: workspace?.id,
    renderMemoryNotice: runId => {
      const sequence = finishedSequences.get(runId)
      return workspace && runId === latestCompletedId && sequence != null
        ? <RunMemoryNotice key={runId} workspaceId={workspace.id} sessionId={sessionId} sequence={sequence} follow/>
        : null
    },
  }), [view?.id, view?.runs, view?.timeline, focus?.callId, view?.activeRun, view?.streamingItemId, submitting, retrying, hiddenRunIds, hiddenUserIds, sessionId, workspace, downloadOne, downloadAll, deliver, handleApproval, approvalSubmitting, finishedSequences, latestCompletedId, setWorkbenchOpen])

  const toggleParticipate = useCallback(async (participate: boolean) => {
    if (!workspace || participateBusy) return
    setParticipateBusy(true)
    const previous = participateInMemory
    setParticipateInMemory(participate)
    try {
      const result = await memoryApi.participate(sessionId, participate)
      setParticipateInMemory(result.participate_in_memory)
      toast.success(participate ? '此对话将参与记忆提炼' : '已关闭此对话的记忆提炼')
    } catch (error) {
      setParticipateInMemory(previous)
      toast.error(error instanceof Error ? error.message : '更新失败')
    } finally {setParticipateBusy(false)}
  }, [workspace, participateBusy, participateInMemory, sessionId])

  const onScroll = () => {
    if (mode !== 'conversation') return
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    setAwayFromBottom(!stickRef.current)
    scrollPositions.current.conversation = el.scrollTop
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
    if (item.kind === 'user' && (hiddenUserIds.includes(item.id) || (retrying != null && item.id === retryEcho(view.timeline, retrying).userId))) return false
    return true
  })
  const hideEndId = outgoing != null && endCount <= outgoing.endCount
    ? [...visibleTimeline].reverse().find((item) => item.kind === 'run_end')?.id ?? null
    : null
  const shownTimeline = hideEndId ? visibleTimeline.filter((item) => item.id !== hideEndId) : visibleTimeline
  const hiddenEndRunId = hideEndId ? view.timeline.find(item => item.id === hideEndId)?.runId : null
  const shownRuns = view.runs.filter(item => !hiddenRunIds.includes(item.id) && item.id !== hiddenEndRunId)
  const retrySettled = retrying != null && retryEcho(view.timeline, retrying).settled
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
  const planBarState = planBarMode(view)
  const timelineStatus = (
    <RunStatus
      place="timeline"
      compacting={compacting && latestCompactionId(view.timeline) === compactAnchor}
      pendingSend={pendingSend}
      activity={activityKind}
      since={activity?.kind === 'model' ? activity.startedAt : activity?.kind === 'stopping' ? activity.requestedAt : null}
      streaming={!!view.streaming?.text}
      running={view.activeRun?.status === 'running'}
    />
  )

  const workbench = (
    <Workbench
      active={workbenchOpen && panelView === 'workbench' && inspectorFile == null}
      sessionId={sessionId}
      focus={focus}
      following={following}
      shellCall={shellCall}
      browserCall={browserCall}
      files={view.files}
      tab={tab}
      onTab={setTab}
      onInspectFile={() => {setInspectingFile(true);setInspectedAtCallId(latest?.callId ?? null)}}
      canFollowLatest={!!latest && (inspectingFile ? latest.callId !== inspectedAtCallId : pin !== latest.callId)}
      onFollowLatest={() => {setPinnedCallId(null);setInspectingFile(false);if(latest)setTab(tabForFamily(latest.family))}}
      className="h-full w-full"
    />
  )
  const deliveries = view.files.filter(file => file.source === 'delivery')
  const panel = <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-12 shrink-0 items-center justify-between gap-1 px-3">
      <SegmentedControl<FolderPanelTab | 'workbench'> value={panelView} appearance="icons"
        onValueChange={next => {setInspectorFile(null); setPanelView(next)}} label="右侧面板内容"
        options={[
          ...(workspace ? [{value: 'folder' as const, label: '文件夹', icon: Folder}] : []),
          {value: 'delivered', label: '成果', icon: Inbox},
          {value: 'workbench', label: '查看', icon: Eye},
          ...(workspace ? [{value: 'recent' as const, label: '修改', icon: History}] : []),
        ]}/>
      <IconAction label="收起右侧面板" onClick={() => {setWorkbenchOpen(false); inspectorTrigger.current?.focus()}}><PanelRight/></IconAction>
    </div>
    {workspace && <div className={cn('min-h-0 flex-1', panelView === 'workbench' && 'hidden')}>
      <FolderPanel ref={folderPanel} workspace={workspace} embedded selectedTab={panelView === 'workbench' ? 'folder' : panelView}
        deliveries={deliveries} className="h-full w-full"/>
    </div>}
    {!workspace && panelView === 'delivered' && <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {deliveries.length ? deliveries.map(file => <FileRow key={file.id} file={file} onOpen={() => handlers.onPreviewFile?.(file)}/>)
        : <p className="py-8 text-center text-meta text-muted-foreground">这个对话还没有交付文件。</p>}
    </div>}
    {inspectorFile && panelView === 'workbench' && <div className="min-h-0 flex-1">
      <FilePreview source={{kind: 'attachment', id: inspectorFile.id, filename: inspectorFile.filename, size: inspectorFile.size}}
        onBack={() => {setInspectorFile(null); setPanelView('delivered')}}/>
    </div>}
    <div className={cn('min-h-0 flex-1', (panelView !== 'workbench' || inspectorFile) && 'hidden')}>{workbench}</div>
  </div>
  const workspaceState = workspace ? describeWorkspace(workspace) : null
  const readOnlyReason = workspaceState?.deleting ? '工作区正在删除，对话不可再发送。' : workspaceState?.archived ? '工作区已归档，对话为只读。取消归档后可以继续。' : null
  const panelName = workspace ? '右侧面板' : visibility.developerView ? '工作台' : '查看面板'

  return (
    <>
      <TopbarTitle><span title={displayTitle}>{displayTitle}</span></TopbarTitle>
      <TopbarActions>
        <IconAction label="重命名会话" className="topbar-action" onClick={() => setRenameOpen(true)}><Pencil/></IconAction>
        <IconAction ref={inspectorTrigger} label={workbenchOpen ? `收起${panelName}` : `打开${panelName}`}
          aria-expanded={workbenchOpen} className="topbar-action" onClick={() => setWorkbenchOpen(!workbenchOpen)}><PanelRight/></IconAction>
      </TopbarActions>
      <TaskLayout
        attach={readOnlyReason || mode !== 'conversation' || waitingApproval || submitting ? undefined : files => composer.current?.addFiles(files)}
        addToFolder={!workspaceState?.writable || mode !== 'conversation' ? undefined : files => {
          folderPanel.current?.addFiles(files)
          setPanelView('folder')
          setWorkbenchOpen(true)
        }}
        inspector={<TaskInspector open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} label={panelName}
          floating={inspectorFloating} belowSessionMode={visibility.developerView} triggerRef={inspectorTrigger}>{panel}</TaskInspector>}>
          <header className="flex min-h-12 shrink-0 items-center gap-2 px-4 py-1.5">
            <h1 className="sr-only">{displayTitle}</h1>
            <div className="mr-auto">
              {workspace && <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="关闭后不再从此对话提炼记忆">
                <span>参与记忆</span>
                <Switch size="sm" checked={participateInMemory} disabled={participateBusy} onCheckedChange={checked => void toggleParticipate(checked)} aria-label="参与记忆"/>
              </label>}
            </div>
            {visibility.developerView && <SegmentedControl value={mode} idPrefix="session-mode" label="会话视图" options={[
              {value: 'conversation', label: '聊天', icon: MessageCircle},
              {value: 'developer', label: '日志', icon: Code2},
            ]} onValueChange={next => {setMode(next); if (next === 'developer') setDeveloperVisited(true)}}/>}
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={cn('flex h-full w-[200%] transition-transform duration-200 ease-out motion-reduce:transition-none', mode === 'developer' && '-translate-x-1/2')}>
              <div id="session-mode-panel-conversation" role={visibility.developerView ? 'tabpanel' : undefined} aria-label="聊天" aria-labelledby={visibility.developerView ? 'session-mode-conversation' : undefined} aria-hidden={mode !== 'conversation'} inert={mode !== 'conversation'} className="flex h-full min-w-0 w-1/2 shrink-0 flex-col">
                <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
                  <div ref={messageContentRef} className="mx-auto flex w-full max-w-(--reading-column) flex-col gap-3 px-4 py-3">
                    {shownTimeline.length === 0 && !showOptimistic && (
                      <p className="py-8 text-center text-meta text-faint">
                        这里会显示你的消息、工具操作和最终回复。在下方输入任务后开始。
                      </p>
                    )}
                    <Timeline items={shownTimeline} runs={shownRuns} streaming={view.streaming} activeStatus={timelineStatus} handlers={handlers}/>
                    {showOptimistic && outgoing ? <UserMessage text={outgoing.text} skillName={outgoing.skillName}/> : null}
                    {!view.activeRun && timelineStatus}
                    {!view.activeRun && runFooter?.(run?.id ?? null)}
                    {showPlanExecute && <PlanExecuteBar disabled={submitting || pendingSend} onExecute={() => {
                        void deliver('按计划执行', [], {mode: 'normal', execute_plan: {source_run_id: view.plan!.sourceRunId!, plan_id: view.plan!.planId!, source_seq: view.plan!.sourceSeq!, request_id: crypto.randomUUID()}}).catch((err: unknown) => {
                          if (err instanceof ApiError && err.code === 'conflict') {
                            toast.error(err.message)
                            return
                          }
                          toast.error(err instanceof Error ? err.message : '发送失败')
                        })
                      }}/>}
                  </div>
                </div>
                <div hidden={mode !== 'conversation'} className="relative shrink-0 bg-background px-3 pt-2 pb-5">
                  {mode === 'conversation' && awayFromBottom && <div className="absolute -top-12 inset-x-0 flex justify-center pointer-events-none">
                    <IconAction label="回到底部" variant="outline" className="pointer-events-auto rounded-full bg-card shadow-sm" onClick={() => {
                      stickRef.current = true
                      setAwayFromBottom(false)
                      const el = scrollRef.current
                      if (el) {el.scrollTop = el.scrollHeight; scrollPositions.current.conversation = el.scrollTop}
                    }}><ArrowDown className="size-4" aria-hidden/></IconAction>
                  </div>}
                  <div ref={setPlanColumn} className="mx-auto w-full max-w-(--reading-column)">
                    {mode === 'conversation' && <div className="mb-2 flex items-center justify-end gap-1.5">
                      {planBarState && <PlanBar plan={view.plan} runStatus={view.activeRun?.status ?? null}
                        proposal={planBarState === 'proposal'} className="min-w-0 flex-1"/>}
                      {(view.planHistory?.length ?? 0) > 0 &&
                        <PlanListDialog key={sessionId} plans={view.planHistory ?? []} runs={view.runs} panelWidth={planPanelWidth}/>}
                    </div>}
                    {readOnlyReason ? <p role="status" className="rounded-lg border bg-muted/40 px-3.5 py-3 text-center text-sm text-muted-foreground">{readOnlyReason}</p> : (
                    <ChatInput
                      ref={composer}
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
                      accessory={() => visibility.contextUsage ? <ContextRing usage={view.usage}/> : null}
                      commandHost={{
                        hasSession: true,
                        hasRuns: view.runs.length > 0,
                        runStatus: view.status,
                        waitingApproval,
                        waitingReply: view.activeRun?.activity.kind === 'waiting_reply',
                        submitting,
                        compacting,
                        contextUsage: view.usage,
                        actions: {compact: () => { void handleCompact() }},
                      }}
                    />
                    )}
                  </div>
                </div>
              </div>
              <div ref={developerScrollRef} onScroll={() => {if (mode === 'developer' && developerScrollRef.current) scrollPositions.current.developer = developerScrollRef.current.scrollTop}} id="session-mode-panel-developer" role="tabpanel" aria-label="日志" aria-labelledby="session-mode-developer" aria-hidden={mode !== 'developer'} inert={mode !== 'developer'} className="h-full w-1/2 shrink-0 overflow-y-auto">
                {developerVisited && <DeveloperView view={view} loadTurnRequest={loadTurnRequest} onOpenCall={handlers.onOpenCall} className="mx-auto w-full max-w-(--reading-column)"/>}
              </div>
            </div>
          </div>
      </TaskLayout>

      <FilePreviewDialog file={previewedFile} onClose={() => setPreviewedFile(null)} onDownload={file => void downloadOne(file)}/>

      <RenameSessionDialog sessionId={sessionId} currentTitle={displayTitle} open={renameOpen}
        onOpenChange={setRenameOpen}
        onSaved={(title) => {
          setRenamedTitle({sessionId, title, previousTitle: view.title})
          patchSession(sessionId, {title})
        }}/>
    </>
  )
}
