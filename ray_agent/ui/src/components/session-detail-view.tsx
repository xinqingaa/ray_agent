import type {KnowledgeReference, PlanAcceptance, WorkspaceItem} from '@/lib/api/types'

import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {ArrowDown, ChevronDown, Code2, Download, History, MessageCircle, PanelRight, Pencil} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {PresetCapsule} from '@/components/preset-picker'
import {SKILLS_CHANGED} from '@/lib/api/skills'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {DeveloperView} from '@/components/developer/developer-view'
import {ContextRing} from '@/components/run/context-ring'
import {PlanBar} from '@/components/run/plan-bar'
import {PlanListDialog} from '@/components/run/plan-list-dialog'
import {UserMessage} from '@/components/run/messages'
import {RUN_INPUT_HINT, RunStatus} from '@/components/run/run-status'
import {Timeline, type TimelineHandlers} from '@/components/run/timeline-item'
import {downloadFileBatch} from '@/lib/api/preview'
import {managedPreviewsApi, type ManagedPreview} from '@/lib/api/managed-previews'
import {FilePreviewDialog} from '@/components/preview/file-preview-dialog'
import {ManagedPreviewList} from '@/components/preview/managed-preview-list'
import {downloadSessionFile, Workbench} from '@/components/workbench/workbench'
import {describeWorkspace} from '@/lib/workspace-state'
import {FolderPanel, type FolderPanelRef, type FolderPanelTab} from '@/components/workspace/folder-panel'
import {TaskInspector, TaskInspectorTabs, TaskLayout, type TaskInspectorState} from '@/components/task-layout'
import {TopbarActions, TopbarTitle} from '@/components/sidebar-chrome'
import {FilePreview} from '@/components/preview/file-preview'
import {FileRow, fileMenuEntries} from '@/components/preview/file-row'
import {RunMemoryNotice} from '@/components/run/run-memory-notice'
import {useLocation} from 'react-router'
import {cn} from '@/lib/utils'
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {TopbarMenuContent} from '@/components/topbar-menu'
import {IconAction} from '@/components/ui/icon-action'
import {useSessionDetail} from '@/hooks/use-session-detail'
import {useSessions} from '@/hooks/use-sessions'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {memoryApi} from '@/lib/api/memory'
import {sessionApi} from '@/lib/api/session'
import {USAGE_RECORDED, usageApi, type CostAmounts} from '@/lib/api/usage'
import {useUsagePreferences} from '@/hooks/use-usage-preferences'
import {readRetryDisplay, writeRetryDisplay, retryEchoUserId, conversationTimeline} from '@/lib/retry-display'
import {UncertainSubmissionError} from '@/lib/send-recovery'
import {addDraftReference, readDraft, referenceKey, sessionDraftScope, writeDraft} from '@/lib/drafts'
import {KnowledgeSource} from '@/components/workspace/knowledge-source'
import type {StartOptions} from '@/hooks/use-start-task'
import {normalizeEvents} from '@/lib/session-events'
import {planBarMode} from '@/lib/session-projection'
import {ApiError} from '@/lib/api/fetch'
import type {FileInfo, SSEEventOf} from '@/lib/api/types'
import type {FileView, TimelineItem, ToolCallView} from '@/lib/session-view'

export interface SessionDetailViewProps {
  sessionId: string
  inspector: TaskInspectorState
  /** 工作区会话：右侧面板在文件夹与工作台之间切换，输入框随工作区状态只读 */
  workspace?: WorkspaceItem
  sourceRefresh?: number
  /** 运行结束后显示在时间线末尾的内容（如撤销本次修改）；参数是最近一次运行的 id，还没有运行时为 null */
  renderRunActions?: (runId: string) => ReactNode
}

type ApprovalSubmitting = {callId: string; decision: 'approve' | 'reject'}

/** 把文字追加到输入框末尾（已有内容之后空一行），并把焦点放回输入框。 */
function appendComposerText(input: ChatInputRef | null, text: string) {
  if (!input) return
  const current = input.getInputValue().trimEnd()
  input.setInputText(current ? `${current}\n\n${text}` : text)
}

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

const workspaceReadingPositions = new Map<string, {top: number; follow: boolean}>()

export function SessionDetailView({
  sessionId,
  inspector,
  workspace,
  sourceRefresh,
  renderRunActions,
}: SessionDetailViewProps) {
  const {visibility} = useDeveloperMode()
  const workspaceConversation = workspace != null
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
    refreshing,
    refreshError,
    refresh,
    sendMessage,
    resumeInput,
    submitting,
    stop,
    loadTurnRequest,
    replyApproval,
  } = useSessionDetail(sessionId)
  const {value: usagePreferences} = useUsagePreferences()
  const showCost = usagePreferences?.show_conversation_cost === true
  const [sessionCost, setSessionCost] = useState<{id: string; amounts: CostAmounts} | null>(null)
  const usageRevision = view?.runs.map(run => `${run.id}/${run.status}/${run.costNanos ?? ''}/${run.costCnyNanos ?? ''}/${run.turns.length}`).join(',')
  const usageSources = events.filter(event => ['title', 'compact'].includes(event.type)).length
  useEffect(() => {
    if (!showCost || usageRevision == null) return
    let current = true
    let requestId = 0
    const refreshCost = () => {
      const generation = ++requestId
      void usageApi.session(sessionId).then(result => {
        if (current && requestId === generation) {
          setSessionCost({id: sessionId, amounts: {usd: result.cost_nano_usd ?? null, cny: result.cost_nano_cny ?? null}})
        }
      }).catch(() => {})
    }
    refreshCost()
    window.addEventListener(USAGE_RECORDED, refreshCost)
    return () => {
      current = false
      window.removeEventListener(USAGE_RECORDED, refreshCost)
    }
  }, [sessionId, showCost, usageRevision, usageSources])
  const [showLoading, setShowLoading] = useState(false)
  useEffect(() => {
    if (!workspaceConversation || !loading || view) return
    const timer = window.setTimeout(() => setShowLoading(true), 200)
    return () => window.clearTimeout(timer)
  }, [loading, view, workspaceConversation])
  const [outgoing, setOutgoing] = useState<{text: string; skillName?: string; userCount: number; endCount: number; echo?: boolean} | null>(null)
  const [hiddenRunIds, setHiddenRunIds] = useState<string[]>([])
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([])
  const [retrying, setRetrying] = useState<{text: string; knownUserIds: string[]; fromRunId: string} | null>(null)
  const [continuingRunId, setContinuingRunId] = useState<string | null>(null)
  const [retrySessionId, setRetrySessionId] = useState<string | null>(null)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalSubmitting | null>(null)
  const [localCompacting, setCompacting] = useState(false)
  const [compactAnchor, setCompactAnchor] = useState<string | null>(null)
  const compactArmed = useRef(false)
  const compacting = localCompacting || session?.context_operation?.status === 'compacting'

  const [selectedMode, setMode] = useState<'conversation' | 'developer'>('conversation')
  const mode = visibility.developerView ? selectedMode : 'conversation'
  const [developerVisited, setDeveloperVisited] = useState(false)
  const [runLogRequest, setRunLogRequest] = useState<{runId: string} | null>(null)
  const [inspection, setInspection] = useState<{callId: string | null; request: number} | null>(null)
  const {open: workbenchOpen, setOpen: setWorkbenchOpen, floating: inspectorFloating} = inspector
  const [panelView, setPanelView] = useState<FolderPanelTab | 'workbench'>(workspace ? 'folder' : 'workbench')
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [inspectorSource, setInspectorSource] = useState<KnowledgeReference | null>(null)
  const [inspectorFile, setInspectorFile] = useState<FileView | null>(null)
  const [inspectorPreview, setInspectorPreview] = useState<{previewId: string; initial?: ManagedPreview} | null>(null)
  const [managedPreviews, setManagedPreviews] = useState<ManagedPreview[]>([])
  const inspectorTrigger = useRef<HTMLButtonElement>(null)
  const folderPanel = useRef<FolderPanelRef>(null)
  const composer = useRef<ChatInputRef>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [planHistoryOpen, setPlanHistoryOpen] = useState(false)
  const planHistoryTrigger = useRef<HTMLButtonElement | null>(null)
  const optionsTrigger = useRef<HTMLButtonElement>(null)
  const nextOptionsDialog = useRef<(() => void) | null>(null)
  const restoreOptionsFocus = () => optionsTrigger.current?.focus({preventScroll: true})
  const [renamedTitle, setRenamedTitle] = useState<{sessionId: string; title: string; previousTitle: string} | null>(null)
  const [previewedFile, setPreviewedFile] = useState<FileView | null>(null)
  const [clearedPresetId, setClearedPresetId] = useState<string | null>(null)
  const activePreset = session?.active_preset && clearedPresetId !== session.active_preset.id ? session.active_preset : null
  const activePresetId = session?.active_preset_id ?? null
  useEffect(() => {
    if (!activePresetId) return
    const reload = () => { void refresh() }
    window.addEventListener(SKILLS_CHANGED, reload)
    return () => window.removeEventListener(SKILLS_CHANGED, reload)
  }, [activePresetId, refresh])
  const handleExitPreset = async () => {
    const previous = activePreset?.id ?? null
    if (!previous) return
    setClearedPresetId(previous)
    try {
      await sessionApi.setPreset(sessionId, null)
      toast.success('已退出当前场景，后续将按自由对话进行')
      void refresh()
    } catch (err) {
      setClearedPresetId(null)
      toast.error(err instanceof Error ? err.message : '退出场景失败')
    }
  }
  const [fullscreenPreview, setFullscreenPreview] = useState<{previewId: string; initial?: ManagedPreview} | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const developerScrollRef = useRef<HTMLDivElement>(null)
  const [initialReading] = useState(() => workspaceConversation ? workspaceReadingPositions.get(sessionId) : undefined)
  const scrollPositions = useRef({conversation: initialReading?.top ?? 0, developer: 0})
  const stickRef = useRef(initialReading?.follow ?? true)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const memoryHelpId = useId()
  const [participateInMemory, setParticipateInMemory] = useState(true)
  const [participateBusy, setParticipateBusy] = useState(false)
  const participationRequest = useRef<symbol | null>(null)
  const memoryToastSeq = useRef(new Set<number>())

  useLayoutEffect(() => {
    if (!view?.id) return
    const el = mode === 'conversation' ? scrollRef.current : developerScrollRef.current
    if (el) el.scrollTop = mode === 'conversation' && stickRef.current ? el.scrollHeight : scrollPositions.current[mode]
  }, [mode, developerVisited, view?.id, runLogRequest])

  useLayoutEffect(() => {
    if (runLogRequest) developerScrollRef.current?.focus({preventScroll: true})
  }, [runLogRequest])

  const sessionStatus = view?.status
  const displayTitle = renamedTitle?.sessionId === sessionId && view?.title === renamedTitle.previousTitle
    ? renamedTitle.title : view?.title || '新任务'
  useEffect(() => {
    const holdRunning = outgoing != null
    const status = holdRunning ? 'running' : sessionStatus === 'idle' ? 'pending' : sessionStatus
    if (!status) return
    const item = sessions.find((session) => session.session_id === sessionId)
    if (item?.status === status) return
    patchSession(sessionId, {status})
  }, [sessionId, sessionStatus, sessions, patchSession, outgoing])
  useEffect(() => {
    if (!view) return
    const holdRunning = outgoing != null
    if (holdRunning || view.status !== 'waiting') {
      setWaitKind(sessionId, null)
      return
    }
    setWaitKind(sessionId, view.activeRun?.activity.kind === 'waiting_approval' ? 'approval' : 'reply')
  }, [sessionId, view, outgoing, setWaitKind])

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
  const pin = visibleCalls.find(call => call.callId === inspection?.callId) ?? null
  const focus = inspection ? pin ?? latest : null
  const run = view?.runs.at(-1) ?? null

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
    setContinuingRunId(null)
    setInspection(null)
    setInspectorFile(null)
    setInspectorSource(null)
    setInspectorPreview(null)
    setManagedPreviews([])
    setPreviewedFile(null)
    setClearedPresetId(null)
    setRenameOpen(false)
    setPlanHistoryOpen(false)
    nextOptionsDialog.current = null
    participationRequest.current = null
    setParticipateBusy(false)
    const saved = readRetryDisplay(sessionId)
    setHiddenRunIds(saved.hiddenRunIds)
    setHiddenUserIds(saved.hiddenUserIds)
    setRetrying(saved.pending)
    setRetrySessionId(sessionId)
    if (!workspaceConversation) stickRef.current = true
    scrollRef.current?.removeAttribute('data-reference-reading')
    setAwayFromBottom(false)
  }, [sessionId, workspaceConversation])

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

  const deliver = useCallback(async (message: string, attachmentIds: string[], options?: StartOptions & {execute_plan?: PlanAcceptance; echo?: boolean}) => {
    if (scrollRef.current?.hasAttribute('data-reference-reading')) {
      scrollRef.current.removeAttribute('data-reference-reading')
      stickRef.current = true
    }
    const items = view?.timeline ?? []
    const userCount = items.filter((item) => item.kind === 'user').length
    const endCount = items.filter((item) => item.kind === 'run_end').length
    setOutgoing({text: message, skillName: options?.skill?.id, userCount, endCount, echo: options?.echo !== false})
    try {
      await sendMessage(message, attachmentIds, {mode: options?.mode, model: options?.model, reasoning: options?.reasoning, image_mode: options?.image_mode, skill: options?.skill, execute_plan: options?.execute_plan, knowledge_references: options?.knowledge_references})
    } catch (err) {
      setOutgoing(null)
      throw err
    }
  }, [sendMessage, view?.timeline])

  useEffect(() => {
    if (!retrying || retrySessionId !== sessionId) return
    const items = view?.timeline ?? []
    const userId = retryEchoUserId(items, retrying)
    if (!userId) return
    setHiddenUserIds(prev => prev.includes(userId) ? prev : [...prev, userId])
    setHiddenRunIds(prev => prev.includes(retrying.fromRunId) ? prev : [...prev, retrying.fromRunId])
    setRetrying(null)
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

  const handleSend = useCallback(async (message: string, uploaded: FileInfo[], options?: StartOptions) => {
    try {
      await deliver(message, uploaded.map((file) => file.id), options)
    } catch (err) {
      if (!(err instanceof ApiError) || !['model_connection', 'knowledge_reference'].includes(String(err.details.section)))
        toast.error(err instanceof Error ? err.message : '发送失败，请重试')
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
  const acceptedPlans = useMemo(() => {
    const references = new Map<string, string>()
    for (const event of view?.events ?? []) {
      if (event.type === 'plan' && event.runId && event.payload.accepted_from && typeof event.payload.plan_id === 'string') {
        references.set(event.runId, event.payload.plan_id)
      }
    }
    return references
  }, [view?.events])
  const latestCompletedId = view?.runs.filter(run => run.status === 'completed').at(-1)?.id
  const folderPath = workspace?.folder?.path
  const inspectedRunId = view?.activeRun?.id ?? view?.runs.at(-1)?.id
  const readPaths = useMemo(() => {
    if (!folderPath || !inspectedRunId) return undefined
    const prefix = folderPath.replaceAll('\\', '/').replace(/\/+$/, '') + '/'
    const paths = new Set<string>()
    for (const item of view?.timeline ?? []) {
      if (item.runId !== inspectedRunId) continue
      const calls = item.kind === 'tools' ? item.calls : item.kind === 'approval' ? [item.call] : []
      for (const call of calls) {
        if ((call.name !== 'read_file' && call.name !== 'read_document') || call.status !== 'succeeded') continue
        const result = call.raw.content as {filepath?: unknown; outcome?: {data?: {filepath?: unknown}}} | null
        const filename = result?.outcome?.data?.filepath ?? result?.filepath
        const path = typeof filename === 'string' ? filename.replaceAll('\\', '/') : null
        if (path?.startsWith(prefix)) paths.add(path.slice(prefix.length))
      }
    }
    return paths
  }, [folderPath, inspectedRunId, view?.timeline])

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

  const previewDelivery = useCallback((file: FileView) => {
    setInspectorSource(null)
    setInspectorPreview(null)
    folderPanel.current?.closePreview()
    setPanelView('delivered')
    setWorkbenchOpen(true)
    setInspectorFile(file)
  }, [setWorkbenchOpen])

  const previewEventsCount = useMemo(
    () => events.filter(event => event.type === 'preview').length,
    [events],
  )
  useEffect(() => {
    let cancelled = false
    void managedPreviewsApi.list({sessionId})
      .then(list => {
        if (!cancelled) setManagedPreviews(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, previewEventsCount])

  const upsertManagedPreview = useCallback((next: ManagedPreview) => {
    setManagedPreviews(current => {
      const idx = current.findIndex(item => item.id === next.id)
      if (idx < 0) return [next, ...current]
      const updated = current.slice()
      updated[idx] = next
      return updated
    })
  }, [])

  const removeManagedPreview = useCallback((previewId: string) => {
    setManagedPreviews(current => current.filter(item => item.id !== previewId))
    setInspectorPreview(current => (current?.previewId === previewId ? null : current))
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refresh(),
      managedPreviewsApi.list({sessionId}).then(setManagedPreviews).catch(() => {}),
    ])
  }, [refresh, sessionId])

  const managedPreviewMap = useMemo(
    () => new Map(managedPreviews.map(item => [item.id, item])),
    [managedPreviews],
  )

  useEffect(() => {
    const fileId = new URLSearchParams(search).get('delivery')
    if (!fileId) {locatedDelivery.current = ''; return}
    if (fileId === locatedDelivery.current) return
    const file = view?.files.find(item => item.id === fileId && item.source === 'delivery')
    if (!file) return
    locatedDelivery.current = fileId
    previewDelivery(file)
  }, [search, previewDelivery, view?.files])

  const packingFiles = useRef(false)
  const downloadAll = useCallback(async (files: FileView[]) => {
    if(packingFiles.current)return
    packingFiles.current=true
    try {await downloadFileBatch(files)} catch(error) {toast.error(error instanceof Error ? error.message : '打包失败')}
    finally {packingFiles.current=false}
  }, [])

  const workspaceState = workspace ? describeWorkspace(workspace) : null
  const readOnlyReason = workspaceState?.deleting ? '工作区正在删除，对话不可再发送。' : workspaceState?.archived ? '工作区已归档，对话为只读。取消归档后可以继续。' : null
  const findUnconsumedInput = useCallback(
    (runId: string) => (session?.unconsumed_inputs ?? []).find((item) => item.run_id === runId) ?? null,
    [session?.unconsumed_inputs]
  )

  const handlers = useMemo<TimelineHandlers>(() => ({
    sessionId: view?.id,
    // 引用与填回都追加到输入框已有文字之后，不覆盖用户正在写的内容
    quoteText: text => appendComposerText(composer.current, text),
    fillDraft: text => appendComposerText(composer.current, text),
    selectedCallId: focus?.callId ?? null,
    // 工作区会话的右侧面板也带工作台：点工具卡片切到工作台并选中该工具
    onOpenCall: (callId) => {
      setInspection(current => ({callId, request: (current?.request ?? 0) + 1}))
      setPanelView('workbench')
      setInspectorFile(null)
      setInspectorSource(null)
      setInspectorPreview(null)
      folderPanel.current?.closePreview()
      setWorkbenchOpen(true)
    },
    onOpenRunDetails: visibility.developerView ? runId => {
      scrollPositions.current.developer = 0
      setRunLogRequest({runId})
      setDeveloperVisited(true)
      setMode('developer')
    } : undefined,
    onPreviewFile: (file) => {
      if (file.source === 'delivery') previewDelivery(file)
      else setPreviewedFile(file)
    },
    onFullscreenPreviewFile: (file) => {
      setFullscreenPreview(null)
      setPreviewedFile(file)
    },
    managedPreviews: managedPreviewMap,
    onOpenPreview: (previewId) => {
      setInspectorSource(null)
      setInspectorFile(null)
      folderPanel.current?.closePreview()
      setPanelView('delivered')
      setWorkbenchOpen(true)
      setInspectorPreview({previewId, initial: managedPreviewMap.get(previewId)})
    },
    onOpenPreviewFullscreen: (previewId) => {
      setPreviewedFile(null)
      setFullscreenPreview({previewId, initial: managedPreviewMap.get(previewId)})
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
    continueRunId: (() => {
      if (view?.activeRun || readOnlyReason) return ''
      const latestEnd = [...(view?.timeline ?? [])]
        .reverse()
        .find((item) => item.kind === 'run_end' && item.runId && !hiddenRunIds.includes(item.runId))
      if (!latestEnd || latestEnd.kind !== 'run_end' || !latestEnd.runId) return ''
      const targetRun = view?.runs.find((item) => item.id === latestEnd.runId)
      const lastRun = view?.runs[view.runs.length - 1]
      if (!targetRun || !lastRun || targetRun.id !== lastRun.id) return ''
      if (latestEnd.status === 'cancelled' || latestEnd.status === 'interrupted') return latestEnd.runId
      if (
        latestEnd.status === 'failed' &&
        (!!findUnconsumedInput(latestEnd.runId) ||
          acceptedPlans.has(latestEnd.runId) ||
          (targetRun.summary?.toolCalls ?? 0) > 0 ||
          (targetRun.summary?.turns ?? 0) > 0 ||
          view?.plan?.sourceRunId === latestEnd.runId)
      ) {
        return latestEnd.runId
      }
      return ''
    })(),
    continuingRunId,
    hasUnconsumedInput: (runId) => !!findUnconsumedInput(runId),
    consumedPlanRuns: acceptedPlans,
    planAction: runId => {
      const id = acceptedPlans.get(runId)
      const plan = view?.planHistory?.find(entry => entry.id === id)
      return plan ? <PlanListDialog plans={[plan]} runs={view?.runs ?? []} triggerLabel="查看计划清单"/> : null
    },
    hasPriorTools: runId => (view?.runs.find(item => item.id === runId)?.summary?.toolCalls ?? 0) > 0,
    onContinue: view?.activeRun || submitting || retrying || continuingRunId || readOnlyReason
      ? undefined
      : (runId) => {
          const unconsumed = findUnconsumedInput(runId)
          if (unconsumed) {
            setContinuingRunId(runId)
            void resumeInput(unconsumed.input_id)
              .catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : '继续任务失败')
              })
              .finally(() => {
                setContinuingRunId((current) => (current === runId ? null : current))
              })
            return
          }
          const targetRun = view?.runs.find((item) => item.id === runId)
          const mode = targetRun?.mode === 'plan' && !acceptedPlans.has(runId) ? 'plan' : 'normal'
          setContinuingRunId(runId)
          void deliver('继续', [], {mode})
            .catch((err: unknown) => {
              if (err instanceof UncertainSubmissionError) return
              toast.error(err instanceof Error ? err.message : '继续任务失败')
            })
            .finally(() => {
              setContinuingRunId((current) => (current === runId ? null : current))
            })
        },
    onRetry: view?.activeRun || submitting || retrying || continuingRunId ? undefined : (text, runId) => {
      if (acceptedPlans.has(runId)) return
      const items = view?.timeline ?? []
      const source = items.find(item => item.kind === 'user' && item.runId === runId)
      if (source?.kind !== 'user') return
      const knownUserIds = items.filter(item => item.kind === 'user').map(item => item.id)
      const pending = {text, knownUserIds, fromRunId: runId}
      writeRetryDisplay(sessionId, {hiddenRunIds, hiddenUserIds, pending})
      setRetrying(pending)
      const mode = view?.runs.find(run => run.id === runId)?.mode ?? 'normal'
      void (async () => {
        // 只公开模型和思考档，从服务端读回终态快照后再重发。
        const detail = await sessionApi.getSessionDetail(sessionId, view?.events.at(-1)?.seq)
        const original = detail.runs?.find(item => item.run_id === runId)
        await deliver(source.text, source.attachments.map(file => file.id), {
          echo: false, mode, skill: source.skill, image_mode: source.imageMode, knowledge_references: source.references,
          model: original?.model_id ?? undefined, reasoning: original?.reasoning ?? undefined,
        })
      })().catch((err: unknown) => {
        if (err instanceof UncertainSubmissionError) return
        setRetrying(current => current?.fromRunId === runId ? null : current)
        toast.error(err instanceof Error ? err.message : '重试失败')
      })
    },
    onApprove: (callId) => void handleApproval(callId, 'approve'),
    onReject: (callId) => void handleApproval(callId, 'reject'),
    approvalSubmitting,
    showRunReferences: workspace != null,
    onToggleReferences: (trigger, open, settled) => {
      const el = scrollRef.current
      if (!el || !el.contains(trigger)) return
      if (settled && !el.hasAttribute('data-reference-reading')) return
      // 展开改变内容高度，程序滚动和浏览器锚定都不能把它当作用户回到底部。
      el.setAttribute('data-reference-reading', '')
      stickRef.current = false
      const toolbar = trigger.closest('[data-run-reference-toolbar]')
      if (!toolbar) return
      requestAnimationFrame(() => {
        if (!trigger.isConnected || trigger.getAttribute('aria-expanded') !== String(open)
          || !el.hasAttribute('data-reference-reading')) return
        const viewport = el.getBoundingClientRect()
        const anchor = toolbar.getBoundingClientRect()
        // 本次参考面板只在底部空间不足时露出开头，运行详情保持当前视口。
        const offset = open ? Math.max(0, anchor.bottom + 74 - viewport.bottom) : Math.min(0, anchor.top - viewport.top - 8)
        if (offset) el.scrollTop += offset
      })
    },
    workspaceId: workspace?.id,
    sourceRefresh,
    onOpenSource: workspace ? reference => {
      folderPanel.current?.closePreview()
      setInspectorFile(null)
      setInspectorPreview(null)
      setInspectorSource(reference)
      setPanelView('workbench')
      setWorkbenchOpen(true)
    } : undefined,
    onQuoteSource: workspace?.status === 'active' ? reference => {
      const result = addDraftReference(sessionDraftScope(sessionId), reference)
      if (result === 'added') toast.success('已加入当前输入')
      else toast.message(result === 'duplicate' ? '输入中已有这条引用' : '正在核对上一条消息的受理结果')
    } : undefined,
    renderMemoryNotice: runId => {
      const sequence = finishedSequences.get(runId)
      return workspace && sequence != null
        ? <RunMemoryNotice key={runId} workspaceId={workspace.id} sessionId={sessionId} sequence={sequence} follow={runId === latestCompletedId}
            readOnly={workspace.status === 'archived' || workspace.status === 'deleting'}/>
        : null
    },
    renderRunActions: runId => !view?.activeRun && runId === run?.id ? renderRunActions?.(runId) : null,
  }), [view?.id, view?.runs, view?.timeline, view?.events, view?.plan?.sourceRunId, focus?.callId, view?.activeRun, view?.streamingItemId, submitting, retrying, continuingRunId, hiddenRunIds, hiddenUserIds, sessionId, workspace, readOnlyReason, sourceRefresh, downloadOne, downloadAll, deliver, resumeInput, findUnconsumedInput, previewDelivery, acceptedPlans, view?.planHistory, handleApproval, approvalSubmitting, finishedSequences, latestCompletedId, setWorkbenchOpen, run?.id, renderRunActions, visibility.developerView, managedPreviewMap])

  const toggleParticipate = useCallback(async (participate: boolean) => {
    if (!workspace || participationRequest.current) return
    const request = Symbol()
    participationRequest.current = request
    setParticipateBusy(true)
    const previous = participateInMemory
    setParticipateInMemory(participate)
    try {
      const result = await memoryApi.participate(sessionId, participate)
      if (participationRequest.current !== request) return
      setParticipateInMemory(result.participate_in_memory)
      toast.success(participate ? '已允许此对话用于工作区记忆' : '此对话的摘要已退出检索，后续不再自动提炼记忆')
    } catch (error) {
      if (participationRequest.current !== request) return
      setParticipateInMemory(previous)
      toast.error(error instanceof Error ? error.message : '更新失败')
    } finally {
      if (participationRequest.current === request) {
        participationRequest.current = null
        setParticipateBusy(false)
      }
    }
  }, [workspace, participateInMemory, sessionId])

  const resumeConversationScroll = (target: EventTarget | null) => {
    if (target instanceof Element && target.closest('[data-run-context-scroll], [data-run-primary-scroll]')) return
    scrollRef.current?.removeAttribute('data-reference-reading')
  }

  const onScroll = () => {
    if (mode !== 'conversation' || !view) return
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (!el.hasAttribute('data-reference-reading')) stickRef.current = distance < 200
    setAwayFromBottom(distance >= 200)
    scrollPositions.current.conversation = el.scrollTop
    if (workspace) {
      workspaceReadingPositions.delete(sessionId)
      workspaceReadingPositions.set(sessionId, {top: el.scrollTop, follow: stickRef.current})
      if (workspaceReadingPositions.size > 50) workspaceReadingPositions.delete(workspaceReadingPositions.keys().next().value!)
    }
  }

  const activity = view?.activeRun?.activity
  const activityKind = activity?.kind
  const timeline = view?.timeline ?? []
  const userCount = timeline.filter((item) => item.kind === 'user').length
  const echoed = outgoing != null && userCount > outgoing.userCount
  const endCount = timeline.filter((item) => item.kind === 'run_end').length
  const visible = conversationTimeline(timeline, view?.runs ?? [], {hiddenRunIds, hiddenUserIds, pending: retrying})
  const hiddenEnd = outgoing != null && outgoing.echo !== false && endCount <= outgoing.endCount
    ? visible.items.findLast(item => item.kind === 'run_end') : undefined
  const shownTimeline = hiddenEnd ? visible.items.filter(item => item.id !== hiddenEnd.id) : visible.items
  const shownRuns = hiddenEnd ? visible.runs.filter(run => run.id !== hiddenEnd.runId) : visible.runs
  const pendingSend = outgoing != null
  const showOptimistic = outgoing != null && outgoing.echo !== false && !echoed && !submitting
  const waitingReply = activityKind === 'waiting_reply'
  const pauseMode = waitingReply ? false : activityKind === 'stopping' ? 'stopping' : (outgoing || submitting || view?.status === 'running' || waitingApproval) ? 'ready' as const : false

  const placeholder = waitingApproval
    ? RUN_INPUT_HINT.approval
    : view?.status === 'waiting'
    ? RUN_INPUT_HINT.reply
    : view?.status === 'running'
      ? RUN_INPUT_HINT.running
      : RUN_INPUT_HINT.idle

  const executePlan = () => {
    const plan = view?.plan
    if (!plan?.sourceRunId || !plan.planId || plan.sourceSeq == null) return
    void deliver('按计划执行', [], {mode: 'normal', execute_plan: {
      source_run_id: plan.sourceRunId, plan_id: plan.planId, source_seq: plan.sourceSeq, request_id: crypto.randomUUID(),
    }}).catch((err: unknown) => toast.error(err instanceof Error ? err.message : '发送失败'))
  }
  const planBarState = view && planBarMode(view)
  const timelineStatus = (
    <RunStatus
      place="timeline"
      compacting={compacting && latestCompactionId(timeline) === compactAnchor}
      pendingSend={pendingSend}
      activity={activityKind}
      since={activity?.kind === 'model' ? activity.startedAt : activity?.kind === 'stopping' ? activity.requestedAt : null}
      streaming={!!view?.streaming?.text}
      running={view?.activeRun?.status === 'running'}
    />
  )

  const planHistory = view?.planHistory ?? []
  const files = view?.files ?? []
  const deliveries = view?.files.filter(file => file.source === 'delivery')
  const askAgentFix = !readOnlyReason ? (prompt: string) => {
    appendComposerText(composer.current, prompt)
  } : undefined
  const panel = <div className="flex h-full min-h-0 flex-col">
    <TaskInspectorTabs value={panelView} workspace={workspace != null} onActions={setToolbarTarget}
      onChange={next => {setInspectorSource(null); setInspectorFile(null); setInspectorPreview(null); folderPanel.current?.closePreview(); setPanelView(next)}}
      onClose={inspectorFloating ? () => {setWorkbenchOpen(false); inspectorTrigger.current?.focus()} : undefined}/>
    {workspace && <div className={cn('min-h-0 flex-1', (panelView === 'workbench' || inspectorFile || inspectorPreview) && 'hidden')}>
      <FolderPanel ref={folderPanel} workspace={workspace} embedded selectedTab={panelView === 'workbench' ? 'folder' : panelView}
        toolbarTarget={inspectorFile || inspectorPreview ? null : toolbarTarget} readPaths={readPaths} visible={workbenchOpen && panelView !== 'workbench' && !inspectorFile && !inspectorPreview}
        deliveries={deliveries}
        previews={managedPreviews}
        onOpenManagedPreview={item => setInspectorPreview({previewId: item.id, initial: item})}
        onPreviewUpdated={upsertManagedPreview}
        onPreviewDeleted={removeManagedPreview}
        onAskAgentFix={askAgentFix}
        deliveryStatus={{loading: false, refreshing, error: refreshError, retry: () => void refreshAll()}}
        onOpenDelivery={previewDelivery} className="h-full w-full"/>
    </div>}
    {!workspace && panelView === 'delivered' && !inspectorFile && !inspectorPreview && <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {refreshError && (Boolean(deliveries?.length) || managedPreviews.length > 0) && <div role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-state-failed/30 bg-state-failed-soft px-2.5 py-2 text-xs text-state-failed">
        <span className="min-w-0 flex-1 wrap-anywhere">{refreshError}</span>
        <Button size="xs" variant="ghost" disabled={refreshing} onClick={() => void refreshAll()}>重试</Button>
      </div>}
      <ManagedPreviewList
        previews={managedPreviews}
        htmlDeliveries={deliveries}
        onOpen={item => setInspectorPreview({previewId: item.id, initial: item})}
        onOpenDelivery={file => handlers.onPreviewFile?.(file)}
        onDownloadDelivery={file => void downloadOne(file)}
        onUpdated={upsertManagedPreview}
        onDeleted={removeManagedPreview}
      />
      {refreshError && !deliveries?.length && managedPreviews.length === 0 ? <div className="space-y-1 px-2 py-6 text-center">
        <p role="alert" className="text-meta text-state-failed">{refreshError}</p>
        <Button size="xs" variant="ghost" disabled={refreshing} onClick={() => void refreshAll()}>重试</Button>
      </div> : deliveries?.length ? <>
        <h2 className="flex items-center justify-between px-1.5 py-1.5 text-xs font-medium text-faint">
          <span>本次交付</span>
          {refreshing && <span role="status">正在刷新…</span>}
        </h2>
        {deliveries.map(file => <FileRow key={file.id} file={file} versionLabel="交付版本"
          menu={fileMenuEntries(file, {onPreview: f => handlers.onPreviewFile?.(f), onDownload: f => void downloadOne(f)})}
          actions={<IconAction label={`下载 ${file.filename}`} onClick={() => void downloadOne(file)}><Download className="size-4" aria-hidden/></IconAction>}
          onOpen={() => handlers.onPreviewFile?.(file)}/>)}
      </> : managedPreviews.length === 0 ? <p className="py-8 text-center text-meta text-muted-foreground">这个对话还没有交付文件。</p> : null}
    </div>}
    {inspectorSource && workspace && workbenchOpen && <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <KnowledgeSource key={referenceKey(inspectorSource)} workspaceId={workspace.id} reference={inspectorSource}
        showOriginal refresh={sourceRefresh} onBack={() => setInspectorSource(null)}/>
    </div>}
    {inspectorPreview && <div className="min-h-0 flex-1">
      <FilePreview
        source={{kind: 'managed', previewId: inspectorPreview.previewId, initial: inspectorPreview.initial}}
        onBack={() => setInspectorPreview(null)}
        onPreviewChange={upsertManagedPreview}
        onPreviewDeleted={removeManagedPreview}
        onAskAgentFix={askAgentFix}
      />
    </div>}
    {inspectorFile && !inspectorPreview && <div className="min-h-0 flex-1">
      <FilePreview source={{kind: 'attachment', id: inspectorFile.id, filename: inspectorFile.filename, size: inspectorFile.size}}
        onBack={() => setInspectorFile(null)}/>
    </div>}
    <div className={cn('min-h-0 flex-1', (panelView !== 'workbench' || inspectorFile || inspectorPreview || inspectorSource) && 'hidden')}>
      <Workbench key={inspection?.request ?? 0} focus={focus} files={files}
        canFollowLatest={!!latest && (!inspection || !!pin && latest.callId !== pin.callId)}
        onFollowLatest={() => setInspection(current => ({callId: null, request: (current?.request ?? 0) + 1}))}/>
    </div>
  </div>
  const panelName = workspace ? '右侧面板' : visibility.developerView ? '工作台' : '查看面板'

  return (
    <>
      {view && <TopbarTitle>
        <DropdownMenu key={sessionId} modal={false}>
          <DropdownMenuTrigger asChild>
            <button ref={optionsTrigger} type="button" className="conversation-options-trigger" aria-label={`对话选项，${displayTitle}`}>
              <span className="min-w-0 truncate" title={displayTitle}>{displayTitle}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden/>
            </button>
          </DropdownMenuTrigger>
          <TopbarMenuContent title="对话选项" align="start" onCloseAutoFocus={event => {
            const open = nextOptionsDialog.current
            if (!open) return
            nextOptionsDialog.current = null
            event.preventDefault()
            open()
          }}>
            {workspace && <>
              <DropdownMenuCheckboxItem indicator="switch" checked={participateInMemory}
                aria-label="将此对话用于工作区记忆" aria-describedby={memoryHelpId}
                disabled={participateBusy || scopedSessionId !== sessionId} onSelect={event => event.preventDefault()}
                onCheckedChange={checked => void toggleParticipate(checked)}>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block">将此对话用于工作区记忆</span>
                  <span id={memoryHelpId} className="mt-0.5 block text-xs leading-4 text-muted-foreground">摘要可供其他对话检索。开启自动记忆时也会提炼记忆。</span>
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator/>
            </>}
            <DropdownMenuItem onSelect={() => {nextOptionsDialog.current = () => setRenameOpen(true)}}>
              <Pencil aria-hidden/>重命名对话
            </DropdownMenuItem>
            {planHistory.length > 0 && <DropdownMenuItem onSelect={() => {
              nextOptionsDialog.current = () => {
                planHistoryTrigger.current = optionsTrigger.current
                setPlanHistoryOpen(true)
              }
            }}>
              <History aria-hidden/>历史清单
            </DropdownMenuItem>}
          </TopbarMenuContent>
        </DropdownMenu>
      </TopbarTitle>}
      <TopbarActions>
        <IconAction ref={inspectorTrigger} label={workbenchOpen ? `收起${panelName}` : `打开${panelName}`}
          aria-expanded={workbenchOpen} className="topbar-action" onClick={() => setWorkbenchOpen(!workbenchOpen)}><PanelRight/></IconAction>
      </TopbarActions>
      <TaskLayout workspace={Boolean(workspace)}
        folderRootId={workspaceState?.writable ? workspace?.folder?.root_id : undefined}
        attach={!view || readOnlyReason || mode !== 'conversation' || waitingApproval || submitting ? undefined : files => composer.current?.addFiles(files)}
        addToFolder={!workspaceState?.writable || mode !== 'conversation' ? undefined : (files, directory) => {
          folderPanel.current?.addFiles(files, directory)
          setInspectorFile(null)
          setInspectorSource(null)
          setInspectorPreview(null)
          setPanelView('folder')
          setWorkbenchOpen(true)
        }}
        inspector={<TaskInspector state={inspector} label={panelName}
          belowSessionMode={visibility.developerView} triggerRef={inspectorTrigger}>{panel}</TaskInspector>}>
          <header className={cn('flex shrink-0 items-center justify-end px-4', visibility.developerView && 'min-h-11 py-1.5')}>
            <h1 className="sr-only">{displayTitle}</h1>
            {visibility.developerView && <SegmentedControl value={mode} idPrefix="session-mode" label="会话视图" options={[
              {value: 'conversation', label: '聊天', icon: MessageCircle},
              {value: 'developer', label: '日志', icon: Code2},
            ]} onValueChange={next => {if (view) {setMode(next); if (next === 'developer') setDeveloperVisited(true)}}}/>}
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={cn('flex h-full w-[200%] transition-transform duration-200 ease-out motion-reduce:transition-none', mode === 'developer' && '-translate-x-1/2')}>
              <div id="session-mode-panel-conversation" role={visibility.developerView ? 'tabpanel' : undefined} aria-label="聊天" aria-labelledby={visibility.developerView ? 'session-mode-conversation' : undefined} aria-hidden={mode !== 'conversation'} inert={mode !== 'conversation'} className="flex h-full min-w-0 w-1/2 shrink-0 flex-col">
                <div ref={scrollRef} onScroll={onScroll} aria-busy={loading && !view} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', workspace && 'conversation-scroll')}
                  onWheelCapture={event => {if (event.deltaY) resumeConversationScroll(event.target)}}
                  onTouchMoveCapture={event => resumeConversationScroll(event.target)}
                  onPointerDownCapture={event => {if (event.target === event.currentTarget) resumeConversationScroll(event.target)}}
                  onKeyDownCapture={event => {
                    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) resumeConversationScroll(event.target)
                  }}>
                  {!view ? <div className="flex min-h-full flex-col items-center justify-center gap-2 px-4 text-center">
                    {loading ? (!workspace || showLoading) && <p role="status" className="text-xs text-muted-foreground">正在读取对话</p>
                      : error ? <>
                        <p role="alert" className="text-sm text-state-failed">{error.message}</p>
                        <button type="button" onClick={() => void refresh()} className="rounded-sm text-sm text-signal underline outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          重新读取
                        </button>
                      </> : <p className="text-sm text-muted-foreground">未找到该任务</p>}
                  </div> : <div ref={messageContentRef} className="session-reading mx-auto flex w-full max-w-(--reading-column) flex-col gap-4 py-5">
                    {shownTimeline.length === 0 && !showOptimistic && (
                      <p className="py-8 text-center text-meta text-faint">
                        这里会显示你的消息、工具操作和最终回复。在下方输入任务后开始。
                      </p>
                    )}
                    <Timeline items={shownTimeline} runs={shownRuns} streaming={view.streaming} activeStatus={timelineStatus} handlers={handlers}
                      showCost={showCost} sessionCost={sessionCost?.id === sessionId ? sessionCost.amounts : null}/>
                    {showOptimistic && outgoing ? <UserMessage text={outgoing.text} skillName={outgoing.skillName}/> : null}
                    {!view.activeRun && timelineStatus}
                  </div>}
                </div>
                <div hidden={mode !== 'conversation'} className="relative shrink-0 bg-background px-3 pt-2 pb-5">
                  {mode === 'conversation' && awayFromBottom && <div className="absolute -top-12 inset-x-0 flex justify-center pointer-events-none">
                    <IconAction label="回到底部" variant="outline" className="pointer-events-auto rounded-full bg-card shadow-sm" onClick={() => {
                      stickRef.current = true
                      setAwayFromBottom(false)
                      const el = scrollRef.current
                      if (el) {
                        el.removeAttribute('data-reference-reading')
                        el.scrollTop = el.scrollHeight
                        scrollPositions.current.conversation = el.scrollTop
                      }
                    }}><ArrowDown className="size-4" aria-hidden/></IconAction>
                  </div>}
                  <div className="mx-auto w-full max-w-(--reading-column)">
                    {view && mode === 'conversation' && planBarState && <PlanBar plan={view.plan}
                      runStatus={view.activeRun?.status ?? (planBarState === 'ended' ? (view.runs.at(-1)?.status ?? null) : null)}
                      proposal={planBarState === 'proposal'} className="mb-2"
                      onOpenHistory={planHistory.length > 0 ? trigger => {
                        planHistoryTrigger.current = trigger
                        setPlanHistoryOpen(true)
                      } : undefined}
                      execute={planBarState === 'proposal' && !readOnlyReason ? {disabled: submitting || pendingSend, onClick: executePlan} : undefined}/>}
                    {readOnlyReason ? <p role="status" className="rounded-lg border bg-muted/40 px-3.5 py-3 text-center text-sm text-muted-foreground">{readOnlyReason}</p> : <div inert={!view}>
                    <ChatInput
                      ref={composer}
                      sessionId={sessionId}
                      workspace={workspace != null}
                      workspaceId={workspace?.id}
                      onSend={handleSend}
                      onAbandonSubmission={() => setRetrying(null)}
                      pause={pauseMode}
                      onPause={() => void handleStop()}
                      disabled={!view || submitting || waitingApproval}
                      placeholder={placeholder}
                      savedModel={session?.model_id}
                      savedReasoning={session?.reasoning}
                      runModel={session?.run_model}
                      runReasoning={session?.run_reasoning}
                      contextTokens={view?.usage.context?.usedTokens ?? view?.usage.latestRequest?.usedTokens ?? null}
                      onModelCommitted={() => { void refresh() }}
                      topBanner={activePreset ? <PresetCapsule preset={activePreset} disabled={submitting} onClear={() => void handleExitPreset()}/> : undefined}
                      accessory={view && <ContextRing usage={view.usage}/>}
                      commandHost={{
                        hasSession: true,
                        hasRuns: Boolean(view?.runs.length),
                        runStatus: view?.status ?? 'idle',
                        waitingApproval,
                        waitingReply,
                        submitting,
                        compacting,
                        actions: {compact: () => { void handleCompact() }},
                      }}
                    />
                    </div>}
                  </div>
                </div>
              </div>
              <div ref={developerScrollRef} onScroll={() => {if (mode === 'developer' && developerScrollRef.current) scrollPositions.current.developer = developerScrollRef.current.scrollTop}} id="session-mode-panel-developer" tabIndex={-1} role="tabpanel" aria-label="日志" aria-labelledby="session-mode-developer" aria-hidden={mode !== 'developer'} inert={mode !== 'developer'} className="h-full w-1/2 shrink-0 overflow-y-auto outline-none">
                {view && developerVisited && <DeveloperView view={view} runRequest={runLogRequest} loadTurnRequest={loadTurnRequest} onOpenCall={handlers.onOpenCall} className="mx-auto w-full max-w-(--reading-column)"/>}
              </div>
            </div>
          </div>
      </TaskLayout>

      <FilePreviewDialog
        file={previewedFile}
        source={fullscreenPreview ? {kind: 'managed', previewId: fullscreenPreview.previewId, initial: fullscreenPreview.initial} : null}
        onClose={() => {setPreviewedFile(null); setFullscreenPreview(null)}}
        onDownload={file => void downloadOne(file)}
        onPreviewChange={upsertManagedPreview}
        onPreviewDeleted={removeManagedPreview}
        onAskAgentFix={askAgentFix}
      />

      {view && planHistory.length > 0 && <PlanListDialog key={sessionId} plans={planHistory} runs={view.runs}
        open={planHistoryOpen} onOpenChange={setPlanHistoryOpen} onRestoreFocus={() => {
          const trigger = planHistoryTrigger.current
          if (trigger?.isConnected) trigger.focus({preventScroll: true})
          else restoreOptionsFocus()
        }}/>}
      {view && <RenameSessionDialog sessionId={sessionId} currentTitle={displayTitle} open={renameOpen}
        onOpenChange={setRenameOpen}
        onRestoreFocus={restoreOptionsFocus}
        onSaved={(title) => {
          setRenamedTitle({sessionId, title, previousTitle: view.title})
          patchSession(sessionId, {title})
        }}/>}
    </>
  )
}
