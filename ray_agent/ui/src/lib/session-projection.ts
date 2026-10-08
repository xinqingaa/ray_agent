/**
 * 把 W3 的运行列表与事件投影成 SessionView。
 * 不读取时钟：实时走秒由组件用 startedAt 与当前时间计算。
 * 类型在 session-view.ts，W5 只依赖那些类型。
 */

import type {
  Activity,
  ApprovalStatus,
  ContextEstimate,
  FileView,
  PlanChange,
  PlanItem,
  PlanItemStatus,
  PlanView,
  ProjectView,
  RawEvent,
  RunStatus,
  RunSummary,
  RunView,
  SessionView,
  TimelineItem,
  TokenCounts,
  ToolCallStatus,
  ToolCallView,
  ToolFamily,
  ToolResultView,
  TurnView,
  UsageView,
  CompactTrigger,
  RunMode,
} from '@/lib/session-view'

/** 会话详情里的运行行；缺字段时由 run 事件补 */
export type RunSnapshot = {
  run_id: string
  status: string
  reason?: string | null
  started_at?: number
  ended_at?: number | null
  turns?: number
  model_requests?: number
  tool_calls?: number
  prompt_tokens?: number
  completion_tokens?: number
  cached_tokens?: number | null
}

/** 文本增量。不进入带 seq 的事件列表；同一 (run_id, turn, attempt) 按到达顺序拼接 */
export type DeltaInput = {
  run_id?: string
  runId?: string
  turn: number
  attempt: number
  delta?: string
  text?: string
}

export type ProjectSessionInput = {
  id: string
  title?: string | null
  project?: ProjectView | null
  runs?: RunSnapshot[]
  /** 会话详情的 `{event,data}`、SSE 的 `{type,data}`，或带 type 的扁平事件 */
  events: unknown[]
  contextConfig?: {context_window: number; max_tokens: number; limit: number; watermark: number}
  /** 已请求停止、尚未反映到终态；由订阅方记入，投影不调用 Date.now */
  stoppingRequestedAt?: number | null
  /** 接口不返回配置快照时为空。调用方若已知本次上限可传入 */
  maxTurns?: number | null
  /** 当前连接收到的文本增量。刷新和重连不会重放 */
  deltas?: DeltaInput[]
  /** 键为 streamDraftKey。第一个片段的时间，投影不调用 Date.now */
  streamStartedAt?: Record<string, number>
}

/** 临时条目的键。运行 ID 是 UUID，不含冒号 */
export function streamDraftKey(runId: string, turn: number, attempt: number): string {
  return `${runId}:${turn}:${attempt}`
}

const RUN_STATUSES: readonly RunStatus[] = ['running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted']

const REASON_TEXT: Record<string, string> = {
  max_iterations: '模型请求次数达到本次运行上限',
  context_limit: '上下文达到容量上限，运行已停止',
  output_truncated: '模型输出连续两次超过长度上限被截断',
  model_error: '模型请求失败，运行已停止',
  runner_error: '任务执行出错，运行已停止',
  user_stop: '你停止了这次运行',
  api_restart: '服务重启导致运行中断',
  runner_lost: '执行过程已丢失，运行已中断',
}

const FILE_NAMES = new Set([
  'read_file', 'file_read', 'write_file', 'file_write', 'replace_in_file', 'file_str_replace',
  'search_in_file', 'file_find_in_content', 'find_files', 'file_find_by_name', 'file_list',
])

const BYTE_SUMMARY = new Set(['write_file', 'file_write', 'replace_in_file', 'file_str_replace'])

const VERBS: Record<string, string> = {
  read_file: '读取文件',
  file_read: '读取文件',
  write_file: '写入文件',
  file_write: '写入文件',
  replace_in_file: '替换文件内容',
  file_str_replace: '替换文件内容',
  search_in_file: '搜索文件内容',
  file_find_in_content: '搜索文件内容',
  find_files: '查找文件',
  file_find_by_name: '查找文件',
  file_list: '列出目录',
  shell_execute: '运行命令',
  shell_read_output: '查看终端输出',
  shell_wait_process: '等待进程',
  shell_write_input: '写入进程输入',
  shell_kill_process: '终止进程',
  search_web: '搜索网页',
  info_search_web: '搜索网页',
  web_fetch: '读取网页',
  browser_screenshot: '保存截图',
  browser_tabs: '查看标签页',
  browser_view: '查看页面',
  browser_navigate: '打开网页',
  browser_restart: '重启浏览器',
  browser_click: '点击页面',
  browser_input: '输入文本',
  browser_move_mouse: '移动鼠标',
  browser_press_key: '按下按键',
  browser_select_option: '选择选项',
  browser_scroll_up: '向上滚动',
  browser_scroll_down: '向下滚动',
  browser_console_exec: '执行页面脚本',
  browser_console_view: '查看控制台',
  update_plan: '更新计划',
  deliver_files: '交付文件',
  message_ask_user: '向用户提问',
  get_remote_agent_cards: '查看远程 Agent',
  call_remote_agent: '委派远程 Agent',
}

type StoredEvent = {
  seq: number | null
  runId: string | null
  type: string
  createdAt: number
  data: Record<string, unknown>
}

type RunTrack = {
  id: string
  status: RunStatus | null
  mode: RunMode
  reason: string | null
  startedAt: number
  endedAt: number | null
  firstSeq: number
  summary: RunSummary | null
  lastError: string | null
  awaitingReply: boolean
  sawUser: boolean
  environment?: string
}

type TurnBuild = {
  runId: string
  index: number
  startedAt: number
  endedAt: number | null
  modelMs: number | null
  toolsMs: number | null
  usage: TokenCounts | null
  finishReason: string | null
  toolCallIds: string[]
  idsLocked: boolean
  seenCalls: string[]
  contextEstimate: ContextEstimate | null
  contextWindow: number | null
  /** context_estimate.watermark，token 数；没有则为空 */
  watermarkTokens: number | null
  ttftMs: number | null
  attempts: number | null
  hasAttempts: boolean
  hasTtft: boolean
}

type PendingText = {seq: number | null; at: number; runId: string | null; text: string; turnIndex: number | null}

type LiveCall = {runId: string | null; view: ToolCallView}

const RECONNECT_BASE_MS = 500
const RECONNECT_CAP_MS = 4000

/** 断线后的等待：500ms 起、每次翻倍，上限 4 秒 */
export function reconnectDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt))
  return Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** n)
}

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

const CJK_TOKENS_PER_CHAR = 0.7
const OTHER_TOKENS_PER_CHAR = 0.3

function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (code >= 0x3000 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xffef)
}

/** 与请求容量估算相同的系数：中日韩 0.7 token/字，其余 0.3 */
export function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += isCjk(char) ? CJK_TOKENS_PER_CHAR : OTHER_TOKENS_PER_CHAR
  return tokens
}

export type OutputRate = {tokensPerSecond: number; estimated: boolean}

/**
 * 运行中只用字符估算。轮次结束后，completion_tokens 与 ttft_ms 都有值且 model_ms 更大时用实测；
 * reasoning_tokens 有值时从分子扣除。无 usage、或除法不成立时，若调用方提供了文本和耗时，仍标为估算。
 */
export function resolveOutputRate(input: {
  text?: string
  elapsedMs?: number | null
  turnEnded?: boolean
  modelMs?: number | null
  ttftMs?: number | null
  completionTokens?: number | null
  reasoningTokens?: number | null
}): OutputRate | null {
  const estimated = charOutputRate(input.text ?? '', input.elapsedMs)
  if (!input.turnEnded) return estimated
  const measured = measuredOutputRate(input)
  return measured ?? estimated
}

function charOutputRate(text: string, elapsedMs: number | null | undefined): OutputRate | null {
  if (!text || elapsedMs == null || !(elapsedMs > 0)) return null
  return {tokensPerSecond: estimateTextTokens(text) / (elapsedMs / 1000), estimated: true}
}

function measuredOutputRate(input: {
  modelMs?: number | null
  ttftMs?: number | null
  completionTokens?: number | null
  reasoningTokens?: number | null
}): OutputRate | null {
  const {modelMs, ttftMs, completionTokens, reasoningTokens} = input
  if (completionTokens == null || ttftMs == null || modelMs == null || !(modelMs > ttftMs)) return null
  const tokens = reasoningTokens != null ? completionTokens - reasoningTokens : completionTokens
  if (!(tokens > 0)) return null
  return {tokensPerSecond: tokens / ((modelMs - ttftMs) / 1000), estimated: false}
}

type StreamDraft = {runId: string; turn: number; attempt: number; text: string}

function accumulateDeltas(deltas: DeltaInput[] | undefined): StreamDraft[] {
  const map = new Map<string, StreamDraft>()
  const order: string[] = []
  for (const item of deltas ?? []) {
    const runId = item.runId || item.run_id || ''
    const piece = item.delta ?? item.text ?? ''
    if (!runId || !Number.isFinite(item.turn) || !Number.isFinite(item.attempt) || !piece) continue
    const key = streamDraftKey(runId, item.turn, item.attempt)
    const found = map.get(key)
    if (found) found.text += piece
    else {
      map.set(key, {runId, turn: item.turn, attempt: item.attempt, text: piece})
      order.push(key)
    }
  }
  return order.map((key) => map.get(key) as StreamDraft)
}

function laterAttempt(keys: Set<string>, runId: string, turn: number, attempt: number): boolean {
  const prefix = `${runId}:${turn}:`
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const value = Number(key.slice(prefix.length))
    if (value > attempt) return true
  }
  return false
}

/** 只保留仍在增长的那一份。同一运行里更大的 attempt、另一轮、失败尝试、轮次结束或运行终态都会丢掉旧的 */
function pickStreamingDraft(
  drafts: StreamDraft[],
  runs: Map<string, RunTrack>,
  assistantAttempts: Set<string>,
  failedAttempts: Set<string>,
  completedTurns: Set<string>,
  maxTurnIndex: Map<string, number>,
): StreamDraft | null {
  let chosen: StreamDraft | null = null
  const byRun = new Map<string, StreamDraft[]>()
  for (const draft of drafts) {
    const list = byRun.get(draft.runId) ?? []
    list.push(draft)
    byRun.set(draft.runId, list)
  }
  for (const [runId, list] of byRun) {
    const track = runs.get(runId)
    if (track && isTerminalRunStatus(track.status)) continue
    const latestTurn = Math.max(maxTurnIndex.get(runId) ?? 0, ...list.map((item) => item.turn))
    const onTurn = list.filter((item) => item.turn === latestTurn)
    if (onTurn.length === 0) continue
    const maxAttempt = Math.max(...onTurn.map((item) => item.attempt))
    const draft = onTurn.find((item) => item.attempt === maxAttempt)
    if (!draft || !draft.text.trim()) continue
    const key = streamDraftKey(draft.runId, draft.turn, draft.attempt)
    if (assistantAttempts.has(key) || failedAttempts.has(key)) continue
    if (completedTurns.has(`${draft.runId}:${draft.turn}`)) continue
    if (laterAttempt(failedAttempts, draft.runId, draft.turn, draft.attempt)) continue
    if (laterAttempt(assistantAttempts, draft.runId, draft.turn, draft.attempt)) continue
    chosen = draft
  }
  return chosen
}

export function readEventSeq(event: unknown): number | null {
  if (!isRecord(event)) return null
  if (typeof event.seq === 'number') return event.seq
  if (isRecord(event.data) && typeof event.data.seq === 'number') return event.data.seq
  return null
}

/** 按 seq 去重（保留先到的一条）并按 seq 升序排列。没有 seq 的事件留在末尾 */
export function mergeBySeq<T>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set<number>()
  const sequenced: T[] = []
  const rest: T[] = []
  for (const event of [...existing, ...incoming]) {
    const seq = readEventSeq(event)
    if (seq == null) {
      rest.push(event)
      continue
    }
    if (seen.has(seq)) continue
    seen.add(seq)
    sequenced.push(event)
  }
  sequenced.sort((a, b) => (readEventSeq(a) ?? 0) - (readEventSeq(b) ?? 0))
  return [...sequenced, ...rest]
}

export function projectSession(input: ProjectSessionInput): SessionView {
  const runs = new Map<string, RunTrack>()
  for (const snap of input.runs ?? []) {
    if (!snap?.run_id) continue
    runs.set(snap.run_id, {
      id: snap.run_id,
      status: asRunStatus(snap.status),
      mode: 'normal',
      reason: snap.reason ?? null,
      startedAt: snap.started_at ?? 0,
      endedAt: snap.ended_at ?? null,
      firstSeq: Number.MAX_SAFE_INTEGER,
      summary: isTerminalRunStatus(snap.status) ? summaryFromSnapshot(snap) : null,
      lastError: null,
      awaitingReply: false,
      sawUser: false,
    })
  }

  const normalized = normalizeAll(input.events)
  const turns: TurnBuild[] = []
  const liveCalls: LiveCall[] = []
  const timeline: TimelineItem[] = []
  const files: FileView[] = []
  let pending: PendingText[] = []
  let openGroup: {runId: string | null; turnIndex: number | null; calls: ToolCallView[]} | null = null
  let title = input.title?.trim() ? input.title : ''
  let plan: PlanView | null = null
  let previousPlan: PlanItem[] | null = null
  let planExplanation: string | null = null
  let compactions = 0
  let compactSessionUsage: TokenCounts | null = null
  let lastCompaction: UsageView['lastCompaction'] = null
  let capacityFailure: {estimate: ContextEstimate; at: number; seq: number} | null = null
  let lastTurnStartedSeq: number | null = null
  const currentTurn = new Map<string, number>()
  const maxTurnIndex = new Map<string, number>()
  const assistantAttempts = new Set<string>()
  const failedAttempts = new Set<string>()
  const completedTurns = new Set<string>()
  /** 审批条目在 timeline 中的下标，键为 `${runId}:${callId}`；pending 与结论合并为一条 */
  const approvalIndex = new Map<string, number>()
  /** 审批事件给出的 MCP 服务名与原始工具名，同一调用的工具事件沿用 */
  const callServices = new Map<string, ServiceName>()
  /** 有 pending 审批的运行 */
  const pendingApprovalRuns = new Set<string>()

  const ensureRun = (runId: string, at: number, seq: number | null): RunTrack => {
    let track = runs.get(runId)
    if (!track) {
      track = {
        id: runId,
        status: null,
        mode: 'normal',
        reason: null,
        startedAt: at,
        endedAt: null,
        firstSeq: seq ?? Number.MAX_SAFE_INTEGER,
        summary: null,
        lastError: null,
        awaitingReply: false,
        sawUser: false,
      }
      runs.set(runId, track)
    } else if (seq != null && seq < track.firstSeq) {
      track.firstSeq = seq
    }
    if (!track.startedAt && at) track.startedAt = at
    return track
  }

  const ensureTurn = (runId: string, index: number, at: number): TurnBuild => {
    const found = turns.find((turn) => turn.runId === runId && turn.index === index)
    if (found) return found
    const created: TurnBuild = {
      runId,
      index,
      startedAt: at,
      endedAt: null,
      modelMs: null,
      toolsMs: null,
      usage: null,
      finishReason: null,
      toolCallIds: [],
      idsLocked: false,
      seenCalls: [],
      contextEstimate: null,
      contextWindow: null,
      watermarkTokens: null,
      ttftMs: null,
      attempts: null,
      hasAttempts: false,
      hasTtft: false,
    }
    turns.push(created)
    return created
  }

  const flushNarration = () => {
    for (const msg of pending) pushNarration(timeline, msg)
    pending = []
  }

  const flushFinal = (runId: string | null) => {
    if (pending.length === 0) return
    const last = pending[pending.length - 1]
    for (const msg of pending.slice(0, -1)) pushNarration(timeline, msg)
    timeline.push({
      kind: 'final',
      id: idOf(last.seq, timeline.length),
      runId: last.runId ?? runId,
      at: last.at,
      text: last.text,
      summary: null,
    })
    pending = []
  }

  const flushAsk = (ev: StoredEvent) => {
    const last = pending[pending.length - 1]
    for (const msg of pending.slice(0, -1)) pushNarration(timeline, msg)
    timeline.push({
      kind: 'ask',
      id: idOf(last?.seq ?? ev.seq, timeline.length),
      runId: ev.runId ?? last?.runId ?? null,
      at: last?.at ?? ev.createdAt,
      question: last?.text ?? '',
      answered: false,
    })
    pending = []
  }

  for (const ev of normalized) {
    const data = ev.data
    if (ev.type === 'title') {
      const next = str(data.title)
      if (next) title = next
      continue
    }
    if (ev.type === 'context' || ev.type === 'compact') {
      if (ev.type === 'compact' || data.op === 'compact') {
        compactions += 1
        const before = estimateTotal(data.before_estimate ?? data.beforeEstimate)
          ?? num(data.before_tokens ?? data.beforeTokens)
        const after = estimateTotal(data.after_estimate ?? data.afterEstimate)
          ?? num(data.after_tokens ?? data.afterTokens)
        const usageRaw = data.usage
        if (isRecord(usageRaw)) {
          compactSessionUsage = sumUsage([compactSessionUsage, readUsage(usageRaw)])
        }
        const trigger = asCompactTrigger(data.trigger)
        if (before != null && after != null && trigger) {
          const summary = str(data.summary)
          if (ev.seq != null) {
            lastCompaction = {seq: ev.seq, trigger, beforeTotal: before, afterTotal: after, afterEstimate: readEstimate(data.after_estimate ?? data.afterEstimate), at: ev.createdAt}
          }
          timeline.push({
            kind: 'compaction',
            id: idOf(ev.seq, timeline.length),
            runId: ev.runId,
            at: ev.createdAt,
            beforeTokens: before,
            afterTokens: after,
            summarizedTurns: num(data.summarized_turns ?? data.summarizedTurns) ?? 0,
            summary,
            trigger,
          })
        }
      }
      continue
    }
    if (ev.type === 'attempt') {
      const attemptTurn = num(data.turn ?? data.turn_index ?? data.index) ?? 0
      const attemptNo = num(data.attempt) ?? 1
      if (ev.runId) failedAttempts.add(streamDraftKey(ev.runId, attemptTurn, attemptNo))
      timeline.push({
        kind: 'attempt',
        id: idOf(ev.seq, timeline.length),
        runId: ev.runId,
        at: ev.createdAt,
        turnIndex: attemptTurn,
        attempt: attemptNo,
        reason: str(data.reason) ?? str(data.error) ?? '',
        retried: data.retried === true,
        chars: num(data.chars),
      })
      continue
    }

    const track = ev.runId ? ensureRun(ev.runId, ev.createdAt, ev.seq) : null

    if (ev.type === 'environment' && track) {
      track.environment = str(data.status) ?? undefined
      const protection = isRecord(data.project_file_protection) ? data.project_file_protection : null
      const protectionState = str(protection?.state)
      if (protection && (protectionState === 'skipped' || protectionState === 'failed')) {
        timeline.push({
          kind: 'protection',
          id: idOf(ev.seq, timeline.length),
          runId: track.id,
          at: ev.createdAt,
          state: protectionState,
          message: str(protection.reason) ?? str(protection.error) ?? (protectionState === 'skipped' ? '项目超过快照上限，本次运行没有快照' : '运行前保护失败'),
        })
      }
      continue
    }
    if (ev.type === 'run' && track) {
      const status = asRunStatus(data.status)
      if (!status) continue
      const modeRaw = data.mode
      if (modeRaw === 'plan' || modeRaw === 'normal') track.mode = modeRaw
      const prev = track.status
      track.status = status
      track.reason = typeof data.reason === 'string' ? data.reason : null
      if (status === 'running') {
        if (!track.startedAt) track.startedAt = ev.createdAt
        track.endedAt = null
        track.summary = null
        if (prev === 'waiting') track.awaitingReply = true
      } else if (status === 'waiting') {
        track.awaitingReply = false
      } else if (isTerminalRunStatus(status)) {
        track.endedAt = ev.createdAt || track.endedAt
        track.awaitingReply = false
        track.summary = isRecord(data.summary) ? summaryFromRaw(data.summary, track) : track.summary ?? summaryFromRaw({}, track)
        if (status === 'completed') {
          flushFinal(track.id)
          patchFinal(timeline, track.id, track.summary)
        } else if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
          flushNarration()
          timeline.push({
            kind: 'run_end',
            id: idOf(ev.seq, timeline.length),
            runId: track.id,
            at: ev.createdAt,
            status,
            reason: track.reason,
            reasonText: reasonText(track, input.maxTurns ?? null) ?? '运行已结束',
            retryText: status === 'failed' ? firstUserText(timeline, track.id) : null,
          })
        }
      }
      continue
    }

    if (ev.type === 'error' && track) {
      const error = str(data.error)
      if (error) track.lastError = error
      const estimate = readEstimate(data.context_estimate)
      if (data.fixed_input_exceeded === true && estimate) capacityFailure = {estimate, at: ev.createdAt, seq: ev.seq ?? 0}
      continue
    }

    if (ev.type === 'turn' && track) {
      const index = num(data.index)
      if (index == null) continue
      const turn = ensureTurn(track.id, index, ev.createdAt)
      if (data.phase === 'started') {
        if (pending.length > 0) flushNarration()
        turn.startedAt = ev.createdAt
        if (ev.seq != null) lastTurnStartedSeq = ev.seq
        const window = num(data.context_window)
        if (window != null) turn.contextWindow = window
        const estimate = readEstimate(data.context_estimate)
        if (estimate) turn.contextEstimate = estimate
        const watermark = readWatermarkTokens(data.context_estimate)
        if (watermark != null) turn.watermarkTokens = watermark
        currentTurn.set(track.id, index)
        const prevMax = maxTurnIndex.get(track.id) ?? 0
        if (index > prevMax) maxTurnIndex.set(track.id, index)
      } else if (data.phase === 'completed') {
        completedTurns.add(`${track.id}:${index}`)
        turn.endedAt = ev.createdAt
        turn.modelMs = num(data.model_ms)
        turn.toolsMs = num(data.tools_ms)
        turn.usage = readUsage(data.usage)
        turn.finishReason = str(data.finish_reason)
        if (Array.isArray(data.tool_call_ids)) {
          turn.toolCallIds = data.tool_call_ids.filter((id): id is string => typeof id === 'string')
          turn.idsLocked = true
        }
        const attempts = num(data.attempts)
        if (attempts != null) {
          turn.attempts = attempts
          turn.hasAttempts = true
        }
        const ttft = num(data.ttft_ms)
        if (ttft != null) {
          turn.ttftMs = ttft
          turn.hasTtft = true
        }
      }
      continue
    }

    if (ev.type === 'message') {
      const role = data.role
      const text = str(data.message) ?? ''
      const attachments = readFiles(data.attachments, role === 'user' ? 'upload' : 'delivery')
      for (const file of attachments) addFile(files, file)
      if (role === 'user') {
        if (pending.length > 0) flushNarration()
        const injected = Boolean(track && track.status === 'running' && track.sawUser && !track.awaitingReply)
        if (track?.awaitingReply) {
          answerLatestAsk(timeline, ev.runId)
          track.awaitingReply = false
        }
        if (track) track.sawUser = true
        timeline.push({
          kind: 'user',
          id: idOf(ev.seq, timeline.length),
          runId: ev.runId,
          at: ev.createdAt,
          text,
          attachments,
          injected,
        })
        continue
      }
      if (role === 'assistant' && text.trim() && attachments.length === 0) {
        const attempt = num(data.attempt)
        const turnIndex = ev.runId ? currentTurn.get(ev.runId) : null
        if (attempt != null && turnIndex != null && ev.runId) {
          assistantAttempts.add(streamDraftKey(ev.runId, turnIndex, attempt))
        }
      }
      if (role === 'assistant' && attachments.length > 0) {
        timeline.push({
          kind: 'delivery',
          id: idOf(ev.seq, timeline.length),
          runId: ev.runId,
          at: ev.createdAt,
          files: attachments,
          note: text,
        })
        continue
      }
      if (role === 'assistant' && text.trim()) {
        pending.push({seq: ev.seq, at: ev.createdAt, runId: ev.runId, text, turnIndex: ev.runId ? currentTurn.get(ev.runId) ?? null : null})
      }
      continue
    }

    if (ev.type === 'tool') {
      const callId = str(data.tool_call_id) ?? str(data.call_id) ?? (ev.seq != null ? `call-${ev.seq}` : `call-${liveCalls.length}`)
      const phase = str(data.status)
      const name = str(data.function) ?? str(data.function_name) ?? ''
      const toolset = str(data.name) ?? str(data.tool_name) ?? ''
      const args = readArgs(data)
      if (name === 'update_plan') {
        const explanation = str(args.explanation)
        if (explanation) planExplanation = explanation
      }
      const key = `${ev.runId ?? ''}:${callId}`
      const presented = presentTool(name, toolset, args, callServices.get(key))
      let live = liveCalls.find((item) => `${item.runId ?? ''}:${item.view.callId}` === key)
      if (!live) {
        const turnIndex = ev.runId ? currentTurn.get(ev.runId) ?? null : null
        const view: ToolCallView = {
          callId,
          family: presented.family,
          name,
          toolset,
          title: presented.title,
          verb: presented.verb,
          target: presented.target,
          argSummary: presented.argSummary,
          status: 'running',
          startedAt: ev.createdAt,
          durationMs: null,
          result: null,
          raw: {args, content: data.content ?? null},
        }
        live = {runId: ev.runId, view}
        liveCalls.push(live)
        const sameGroup = openGroup && openGroup.runId === ev.runId && openGroup.turnIndex === turnIndex
        if (!sameGroup) {
          if (pending.length > 0) flushNarration()
          const calls: ToolCallView[] = []
          openGroup = {runId: ev.runId, turnIndex, calls}
          timeline.push({
            kind: 'tools',
            id: idOf(ev.seq, timeline.length),
            runId: ev.runId,
            at: ev.createdAt,
            turnIndex,
            calls,
          })
        }
        openGroup?.calls.push(view)
        if (ev.runId && turnIndex != null) {
          const turn = turns.find((item) => item.runId === ev.runId && item.index === turnIndex)
          if (turn && !turn.seenCalls.includes(callId)) turn.seenCalls.push(callId)
        }
        if (sameGroup && pending.length > 0) flushNarration()
      } else {
        live.view.raw = {args: Object.keys(args).length > 0 ? args : live.view.raw.args, content: data.content ?? live.view.raw.content}
        if (presented.target) {
          live.view.verb = presented.verb
          live.view.target = presented.target
          live.view.title = presented.title
          live.view.argSummary = presented.argSummary
          live.view.family = presented.family
        }
      }
      if (phase === 'called' || phase === 'succeeded' || phase === 'failed' || phase === 'denied' || phase === 'skipped' || phase === 'cancelled') {
        const duration = num(data.duration_ms)
        if (duration != null) live.view.durationMs = duration
        const content = data.content ?? null
        const failure = failureOf(data, content)
        const explicit = asToolStatus(phase)
        live.view.status = failure?.status ?? (explicit && explicit !== 'running' ? explicit : 'succeeded')
        live.view.result = buildResult(name, data, content, failure?.error ?? null)
        if (data.content !== undefined) live.view.raw = {...live.view.raw, content}
      }
      continue
    }

    if (ev.type === 'approval') {
      const callId = str(data.tool_call_id) ?? str(data.call_id) ?? ''
      if (!callId) continue
      const key = `${ev.runId ?? ''}:${callId}`
      const status = asApprovalStatus(data.status)
      const decidedAt = status === 'pending' ? null : num(data.decided_at) ?? ev.createdAt
      if (ev.runId) {
        if (status === 'pending') pendingApprovalRuns.add(ev.runId)
        else pendingApprovalRuns.delete(ev.runId)
      }
      const server = str(data.service)
      const serviceTool = str(data.service_tool)
      const name = str(data.function) ?? ''
      const toolset = str(data.name) ?? ''
      if (server && serviceTool && familyOf(name, toolset) === 'mcp') callServices.set(key, {server, tool: serviceTool})
      const existing = approvalIndex.get(key)
      if (existing != null) {
        const item = timeline[existing]
        if (item.kind === 'approval') timeline[existing] = {...item, status, decidedAt}
        if (status === 'expired') markExpired(liveCalls, key)
        continue
      }
      let live = liveCalls.find((item) => `${item.runId ?? ''}:${item.view.callId}` === key)
      if (!live) {
        // 挂起的调用没有工具事件：从审批事件构造调用条目，后续 calling / called 更新同一个对象
        const args = readArgs(data)
        const presented = presentTool(name, toolset, args, callServices.get(key))
        live = {
          runId: ev.runId,
          view: {
            callId,
            family: presented.family,
            name,
            toolset,
            title: presented.title,
            verb: presented.verb,
            target: presented.target,
            argSummary: presented.argSummary,
            status: 'running',
            startedAt: ev.createdAt,
            durationMs: null,
            result: null,
            raw: {args, content: null},
          },
        }
        liveCalls.push(live)
      }
      if (pending.length > 0) flushNarration()
      openGroup = null
      approvalIndex.set(key, timeline.length)
      timeline.push({
        kind: 'approval',
        id: idOf(ev.seq, timeline.length),
        runId: ev.runId,
        at: ev.createdAt,
        call: live.view,
        status,
        decidedAt,
      })
      if (status === 'expired') markExpired(liveCalls, key)
      continue
    }

    if (ev.type === 'plan') {
      const items = readPlanItems(data.steps, previousPlan, ev.createdAt)
      const changed = previousPlan ? diffPlan(previousPlan, items) : []
      const incoming = str(data.explanation) ?? str(data.message) ?? planExplanation
      plan = {...nextPlan(plan, items, changed, incoming, ev.createdAt), planId: str(data.plan_id), sourceRunId: ev.runId}
      previousPlan = items.map((item) => ({...item}))
      planExplanation = null
      continue
    }

    if (ev.type === 'wait') {
      // 审批挂起也会发 wait，那时等的是批准而不是回复
      if (ev.runId && pendingApprovalRuns.has(ev.runId)) flushNarration()
      else flushAsk(ev)
      continue
    }

    if (ev.type === 'done') {
      flushFinal(ev.runId)
    }
  }

  if (pending.length > 0) flushNarration()

  const streamingDraft = pickStreamingDraft(
    accumulateDeltas(input.deltas),
    runs,
    assistantAttempts,
    failedAttempts,
    completedTurns,
    maxTurnIndex,
  )
  let streamingItemId: string | null = null
  let streaming: SessionView['streaming'] = null
  if (streamingDraft && streamingDraft.text.trim()) {
    const itemId = `stream:${streamingDraft.runId}:${streamingDraft.turn}:${streamingDraft.attempt}`
    const startedAt = input.streamStartedAt?.[streamDraftKey(streamingDraft.runId, streamingDraft.turn, streamingDraft.attempt)] ?? null
    timeline.push({
      kind: 'narration',
      id: itemId,
      runId: streamingDraft.runId,
      at: startedAt ?? 0,
      text: streamingDraft.text,
      turnIndex: streamingDraft.turn,
    })
    streamingItemId = itemId
    streaming = {
      itemId,
      runId: streamingDraft.runId,
      turn: streamingDraft.turn,
      attempt: streamingDraft.attempt,
      text: streamingDraft.text,
      startedAt,
    }
  }

  for (const live of liveCalls) {
    if (live.view.status !== 'running') continue
    const track = live.runId ? runs.get(live.runId) : undefined
    if (!track?.status || !isTerminalRunStatus(track.status)) continue
    const error = track.status === 'cancelled'
      ? '已取消：运行被停止'
      : track.status === 'interrupted'
        ? '已取消：运行中断，结果未知'
        : '执行中断，结果未知'
    live.view.status = track.status === 'failed' ? 'failed' : 'cancelled'
    live.view.result = {
      exitCode: null,
      truncated: false,
      fullOutputPath: null,
      rawChars: null,
      error,
      summary: null,
    }
  }

  const ordered = [...runs.values()]
    .filter((track) => track.status != null)
    .sort((a, b) => a.startedAt - b.startedAt || a.firstSeq - b.firstSeq)
  const activeTrack = [...ordered].reverse().find((track) => track.status === 'running' || track.status === 'waiting') ?? null

  const runViews = ordered.map((track) => toRunView(track, turns, liveCalls, timeline, input, activeTrack?.id === track.id))
  const activeRun = activeTrack ? runViews.find((run) => run.id === activeTrack.id) ?? null : null
  const latest = runViews[runViews.length - 1]
  const sessionTokens = sumUsage([sumUsage(turns.map((turn) => turn.usage)), compactSessionUsage])
  let context = usageContext(turns, lastCompaction, lastTurnStartedSeq)
  if (capacityFailure && capacityFailure.seq > Math.max(lastTurnStartedSeq ?? 0, lastCompaction?.seq ?? 0)) {
    const e = capacityFailure.estimate
    if (e.contextWindow != null && e.contextWindow > 0) context = {
      usedTokens: e.system + e.tools + e.history + e.toolResults,
      windowTokens: e.contextWindow, lastTurnTokens: context?.lastTurnTokens ?? null,
      source: 'request_estimate', fixedInputExceeded: true, snapshotAt: capacityFailure.at,
      inputLimit: e.inputLimit, maxTokens: e.maxTokens, watermarkTokens: e.watermarkTokens,
      inputRemaining: 0, estimate: e,
    }
  }
  if (context && input.contextConfig) {
    context.configChanged = context.windowTokens !== input.contextConfig.context_window
      || context.maxTokens != null && context.maxTokens !== input.contextConfig.max_tokens
      || context.inputLimit != null && context.inputLimit !== input.contextConfig.limit
      || context.watermarkTokens != null && context.watermarkTokens !== input.contextConfig.watermark
  }

  const rawEvents: RawEvent[] = normalized
    .filter((ev) => ev.seq != null)
    .map((ev) => ({
      seq: ev.seq as number,
      runId: ev.runId,
      type: ev.type,
      createdAt: ev.createdAt,
      payload: {...ev.data},
    }))

  const project: ProjectView | null = input.project ?? null

  return {
    id: input.id,
    title,
    status: activeRun?.status ?? latest?.status ?? 'idle',
    project,
    runs: runViews,
    activeRun,
    timeline,
    plan,
    usage: {
      session: sessionTokens,
      context,
      lastCompaction,
      watermarkRatio: context?.watermarkTokens != null ? context.watermarkTokens / context.windowTokens : null,
      compactions,
    },
    files,
    events: rawEvents,
    streamingItemId,
    streaming,
  }
}

function toRunView(
  track: RunTrack,
  turns: TurnBuild[],
  liveCalls: LiveCall[],
  timeline: TimelineItem[],
  input: ProjectSessionInput,
  active: boolean,
): RunView {
  const status = track.status ?? 'running'
  const mine = turns.filter((turn) => turn.runId === track.id).sort((a, b) => a.index - b.index)
  const turnViews = mine.map(toTurnView)
  return {
    id: track.id,
    status,
    mode: track.mode,
    reason: track.reason,
    reasonText: reasonText(track, input.maxTurns ?? null),
    startedAt: track.startedAt,
    endedAt: track.endedAt,
    turns: turnViews,
    maxTurns: input.maxTurns ?? null,
    summary: isTerminalRunStatus(status) ? track.summary : null,
    tokens: sumUsage(mine.map((turn) => turn.usage)),
    activity: active ? activityOf(track, mine, liveCalls, timeline, input.stoppingRequestedAt ?? null) : {kind: 'idle'},
  }
}

function toTurnView(turn: TurnBuild): TurnView {
  const view: TurnView = {
    index: turn.index,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    modelMs: turn.modelMs,
    toolsMs: turn.toolsMs,
    usage: turn.usage,
    finishReason: turn.finishReason,
    toolCallIds: turn.idsLocked ? turn.toolCallIds : turn.seenCalls,
    contextEstimate: turn.contextEstimate,
  }
  if (turn.hasTtft) view.ttftMs = turn.ttftMs
  if (turn.hasAttempts) view.attempts = turn.attempts
  return view
}

function activityOf(
  track: RunTrack,
  turns: TurnBuild[],
  liveCalls: LiveCall[],
  timeline: TimelineItem[],
  stoppingRequestedAt: number | null,
): Activity {
  if ((track.status === 'running' || track.status === 'waiting') && stoppingRequestedAt != null) {
    return {kind: 'stopping', requestedAt: stoppingRequestedAt}
  }
  if (track.status === 'waiting' && track.reason === 'approval') {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i]
      if (item.kind === 'approval' && item.runId === track.id && item.status === 'pending') {
        return {kind: 'waiting_approval', callId: item.call.callId, title: item.call.title}
      }
    }
    const call = [...liveCalls].reverse().find((item) => item.runId === track.id)
    return {kind: 'waiting_approval', callId: call?.view.callId ?? '', title: call?.view.title ?? ''}
  }
  if (track.status === 'waiting') {
    let question = ''
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i]
      if (item.kind === 'ask' && item.runId === track.id) {
        question = item.question
        break
      }
    }
    return {kind: 'waiting_reply', question}
  }
  if (track.status === 'running' && track.environment === 'preparing') {
    return {kind: 'preparing_environment'}
  }
  const runningTool = [...liveCalls].reverse().find((item) => item.runId === track.id && item.view.status === 'running')
  if (runningTool) {
    return {
      kind: 'tool',
      callId: runningTool.view.callId,
      title: runningTool.view.title,
      family: runningTool.view.family,
      startedAt: runningTool.view.startedAt,
    }
  }
  const open = [...turns].reverse().find((turn) => turn.endedAt == null)
  if (track.status === 'running' && open) {
    return {kind: 'model', turnIndex: open.index, startedAt: open.startedAt}
  }
  return {kind: 'idle'}
}

/** 已落库的 Docker 引擎地址对用户没有帮助，展示时改成可执行的说明。 */
function readableFailure(text: string): string {
  if (/http\+docker:\/\/|fromimage=|failed to resolve/i.test(text)) {
    return '准备执行环境失败：沙箱镜像或网络不可用。请核对 SANDBOX_IMAGE、SANDBOX_NETWORK 与 Docker。可在本任务中重试。'
  }
  return text
}

function reasonText(track: RunTrack, maxTurns: number | null): string | null {
  if (track.status == null || track.status === 'running' || track.status === 'waiting' || track.status === 'completed') {
    return null
  }
  if (track.status === 'failed' && track.lastError) {
    const cleaned = track.lastError.replace(/（原因：[A-Za-z0-9_]+）\s*$/u, '').trim()
    if (cleaned) return readableFailure(cleaned)
  }
  if (track.reason === 'max_iterations' && maxTurns != null) {
    return `模型请求次数达到本次运行上限 ${maxTurns} 次。确认任务没有陷入重复后，可在设置中调高“单次运行最大模型请求次数”再重试`
  }
  if (track.reason && REASON_TEXT[track.reason]) return REASON_TEXT[track.reason]
  if (track.status === 'cancelled') return '你停止了这次运行'
  if (track.status === 'interrupted') return '运行已中断'
  return track.reason ? `运行已结束（${track.reason}）` : '运行失败'
}

function usageContext(
  turns: TurnBuild[],
  lastCompaction: UsageView['lastCompaction'],
  lastTurnStartedSeq: number | null,
): UsageView['context'] {
  // 只用最新请求，不能让较早一轮有 usage 的数据覆盖后来缺失 usage 的请求。
  const last = turns[turns.length - 1]
  const completed = [...turns].reverse().find((turn) => turn.endedAt != null)
  const postCompact = !!lastCompaction && lastCompaction.seq > (lastTurnStartedSeq ?? 0)
  const estimate = postCompact ? lastCompaction?.afterEstimate ?? null : last?.contextEstimate ?? null
  // 压缩后的快照不完整时，不与历史请求的窗口拼接计算百分比。
  const window = postCompact ? estimate?.contextWindow ?? null
    : estimate?.contextWindow ?? last?.contextWindow ?? null
  const hasUsage = !postCompact && last?.endedAt != null && last.usage?.prompt != null
  const used = hasUsage ? last.usage!.prompt
    : estimate ? estimate.system + estimate.tools + estimate.history + estimate.toolResults : null
  if (used == null || window == null || window <= 0) return null
  const inputLimit = estimate?.inputLimit ?? null
  const maxTokens = estimate?.maxTokens ?? null
  const safetyTokens = inputLimit != null && maxTokens != null ? window - inputLimit - maxTokens : null
  const prompt = completed?.usage?.prompt
  const completion = completed?.usage?.completion
  return {
    usedTokens: used,
    windowTokens: window,
    lastTurnTokens: prompt != null && completion != null ? prompt + completion : null,
    source: postCompact ? 'compact_estimate' : hasUsage ? 'prompt_usage' : 'request_estimate',
    ...(estimate?.includesProjectContext ? {includesProjectContext: true} : {}),
    snapshotAt: postCompact ? lastCompaction?.at : last?.startedAt,
    inputLimit, maxTokens, safetyTokens,
    watermarkTokens: estimate?.watermarkTokens ?? null,
    inputRemaining: inputLimit != null ? Math.max(0, inputLimit - used) : null,
    estimate,
    ...(postCompact ? {postCompactEstimate: true} : {}),
  }
}

function normalizeAll(events: unknown[]): StoredEvent[] {
  const seen = new Set<number>()
  const out: StoredEvent[] = []
  const list = Array.isArray(events) ? events : []
  for (const raw of list) {
    const ev = normalizeEventRecord(raw)
    if (!ev || ev.type === 'ping' || ev.type === 'delta') continue
    if (ev.seq != null) {
      if (seen.has(ev.seq)) continue
      seen.add(ev.seq)
    }
    out.push(ev)
  }
  out.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
  return out
}

function normalizeEventRecord(raw: unknown): StoredEvent | null {
  if (!isRecord(raw)) return null
  const typeField = raw.type ?? raw.event
  if (typeof typeField !== 'string' || !typeField) return null
  const data = isRecord(raw.data) ? raw.data : raw
  const seq = typeof data.seq === 'number' ? data.seq : typeof raw.seq === 'number' ? raw.seq : null
  const runRaw = data.run_id ?? raw.run_id
  const runId = typeof runRaw === 'string' && runRaw ? runRaw : null
  return {seq, runId, type: typeField, createdAt: readTime(data.created_at ?? raw.created_at), data}
}

function summaryFromSnapshot(run: RunSnapshot): RunSummary {
  const prompt = run.prompt_tokens ?? 0
  const completion = run.completion_tokens ?? 0
  const started = run.started_at ?? 0
  const ended = run.ended_at ?? started
  return {
    durationMs: Math.max(0, ended - started),
    turns: run.turns ?? 0,
    toolCalls: run.tool_calls ?? 0,
    tokens: withCached({prompt, completion, total: prompt + completion}, run.cached_tokens),
  }
}

function summaryFromRaw(raw: Record<string, unknown>, track: RunTrack): RunSummary {
  const prompt = num(raw.prompt_tokens) ?? 0
  const completion = num(raw.completion_tokens) ?? 0
  const duration = num(raw.duration_ms)
  const ended = track.endedAt
  return {
    durationMs: duration ?? (ended != null ? Math.max(0, ended - track.startedAt) : 0),
    turns: num(raw.turns) ?? 0,
    toolCalls: num(raw.tool_calls) ?? 0,
    tokens: withCached({prompt, completion, total: prompt + completion}, raw.cached_tokens == null ? null : num(raw.cached_tokens)),
  }
}

function withCached(tokens: TokenCounts, cached: unknown): TokenCounts {
  if (cached === undefined) return tokens
  return {...tokens, cached: typeof cached === 'number' ? cached : null}
}

function readUsage(raw: unknown): TokenCounts | null {
  if (!isRecord(raw)) return null
  const prompt = num(raw.prompt_tokens)
  const completion = num(raw.completion_tokens)
  const reasoning = num(raw.reasoning_tokens)
  if (prompt == null && completion == null && raw.cached_tokens == null && reasoning == null) return null
  const usage = withCached(
    {prompt, completion, total: prompt != null && completion != null ? prompt + completion : null},
    raw.cached_tokens == null ? null : num(raw.cached_tokens),
  )
  if (reasoning != null) usage.reasoning = reasoning
  return usage
}

function readEstimate(raw: unknown): ContextEstimate | null {
  if (!isRecord(raw)) return null
  const system = num(raw.system) ?? num(raw.system_prompt)
  const tools = num(raw.tools)
  const history = num(raw.history)
  const toolResults = num(raw.toolResults) ?? num(raw.tool_results)
  if (system == null || tools == null || history == null || toolResults == null) return null
  return {system, tools, history, toolResults,
    contextWindow: num(raw.context_window ?? raw.contextWindow),
    maxTokens: num(raw.max_tokens ?? raw.maxTokens),
    inputLimit: num(raw.limit ?? raw.inputLimit),
    watermarkTokens: num(raw.watermark ?? raw.watermarkTokens),
    method: str(raw.method),
    ...(raw.includes_project_context === true || raw.includesProjectContext === true
      ? {includesProjectContext: true} : {}),
  }
}

function readWatermarkTokens(raw: unknown): number | null {
  if (!isRecord(raw)) return null
  return num(raw.watermark)
}


function sumUsage(list: Array<TokenCounts | null>): TokenCounts {
  let prompt: number | null = null
  let completion: number | null = null
  let cached: number | null = null
  for (const usage of list) {
    if (!usage) continue
    if (usage.prompt != null) prompt = (prompt ?? 0) + usage.prompt
    if (usage.completion != null) completion = (completion ?? 0) + usage.completion
    if (usage.cached != null) cached = (cached ?? 0) + usage.cached
  }
  return withCached(
    {prompt, completion, total: prompt != null && completion != null ? prompt + completion : null},
    cached,
  )
}

function readPlanItems(raw: unknown, previous: PlanItem[] | null, at: number): PlanItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((step) => {
    if (!isRecord(step)) return {text: '', status: 'pending' as const, startedAt: null, completedAt: null}
    const text = str(step.description) ?? str(step.step) ?? str(step.text) ?? ''
    const status = planStatus(step.status)
    const old = previous?.find((item) => item.text === text && text)
    let startedAt = old?.startedAt ?? null
    let completedAt = status === 'completed' ? old?.completedAt ?? null : null
    if (status === 'in_progress' && startedAt == null) startedAt = at
    if (status === 'completed' && completedAt == null) completedAt = at
    return {text, status, startedAt, completedAt}
  })
}

function planStatus(raw: unknown): PlanItemStatus {
  if (raw === 'in_progress' || raw === 'running') return 'in_progress'
  if (raw === 'completed') return 'completed'
  return 'pending'
}

function nextPlan(
  current: PlanView | null,
  items: PlanItem[],
  changed: PlanChange[],
  incoming: string | null,
  at: number,
): PlanView {
  const kept = current?.explanation ?? null
  const currentIndex = items.findIndex((item) => item.status === 'in_progress')
  return {
    items,
    currentIndex: currentIndex >= 0 ? currentIndex : null,
    completedCount: items.filter((item) => item.status === 'completed').length,
    explanation: incoming && incoming.trim() ? incoming : kept,
    updatedAt: at,
    changed,
    version: (current?.version ?? 0) + 1,
  }
}

function diffPlan(prev: PlanItem[], next: PlanItem[]): PlanChange[] {
  const used = new Set<number>()
  const changes: PlanChange[] = []
  next.forEach((item, index) => {
    const oldIndex = prev.findIndex((old, i) => !used.has(i) && old.text === item.text)
    if (oldIndex < 0) {
      changes.push({index, text: item.text, kind: 'added'})
      return
    }
    used.add(oldIndex)
    if (prev[oldIndex].status !== item.status) {
      changes.push({index, text: item.text, kind: 'status', from: prev[oldIndex].status, to: item.status})
    }
  })
  prev.forEach((item, index) => {
    if (!used.has(index)) changes.push({index, text: item.text, kind: 'removed'})
  })
  return changes
}

type ServiceName = {server: string; tool: string}

function presentTool(name: string, toolset: string, args: Record<string, unknown>, service?: ServiceName): {
  family: ToolFamily
  verb: string
  target: string
  title: string
  argSummary: string
} {
  const family = familyOf(name, toolset)
  if (family === 'mcp') {
    if (service) {
      const verb = `调用 MCP 工具 ${service.server} / ${service.tool}`
      return {family, verb, target: '', title: verb, argSummary: primitivePairs(args)}
    }
    const server = toolset.startsWith('mcp_') ? toolset.slice(4) : toolset === 'mcp' ? '' : toolset
    const verb = server ? `调用 MCP 工具 ${server} / ${name}` : `调用 MCP 工具 ${name}`
    return {family, verb, target: '', title: verb, argSummary: primitivePairs(args)}
  }
  const verb = VERBS[name] ?? (family === 'a2a' ? '调用远程 Agent' : `调用 ${name || '工具'}`)
  let target = ''
  let argSummary = ''
  if (name === 'update_plan' && Array.isArray(args.plan)) {
    const total = args.plan.length
    const done = args.plan.filter((step) => isRecord(step) && step.status === 'completed').length
    target = `${done}/${total} 已完成`
    argSummary = target
  } else if (name === 'deliver_files') {
    const paths = Array.isArray(args.paths) ? args.paths.map((item) => basename(String(item))) : []
    target = paths.join('、')
    argSummary = target
  } else if (name === 'shell_execute' || name.startsWith('shell_')) {
    const command = str(args.command) ?? ''
    if (command) {
      target = clip(command.split('\n')[0] ?? '', 80)
      argSummary = clip(command, 140)
    } else {
      target = str(args.session_id) ?? ''
      argSummary = target
    }
  } else if (family === 'file') {
    target = clip(str(args.filepath) ?? str(args.path) ?? str(args.glob) ?? str(args.regex) ?? '', 180)
    argSummary = target
  } else if (family === 'search') {
    target = clip(str(args.query) ?? '', 120)
    argSummary = target
  } else if (family === 'browser') {
    target = clip(str(args.url) ?? str(args.key) ?? '', 120)
    argSummary = target
  } else if (name === 'call_remote_agent') {
    target = clip(str(args.query) ?? str(args.id) ?? '', 120)
    argSummary = target
  } else {
    argSummary = primitivePairs(args)
    target = ''
  }
  const title = target ? `${verb} ${target}` : verb
  return {family, verb, target, title, argSummary: argSummary || target}
}

function familyOf(name: string, toolset: string): ToolFamily {
  if (name === 'update_plan' || toolset === 'plan') return 'plan'
  if (name === 'deliver_files' || toolset === 'deliver') return 'deliver'
  if (toolset === 'file' || FILE_NAMES.has(name)) return 'file'
  if (toolset === 'shell' || name.startsWith('shell_')) return 'shell'
  if (toolset === 'browser' || name === 'web_fetch' || name.startsWith('browser_')) return 'browser'
  if (toolset === 'search' || name === 'search_web' || name === 'info_search_web') return 'search'
  if (toolset === 'a2a' || name === 'call_remote_agent' || name === 'get_remote_agent_cards') return 'a2a'
  if (toolset === 'mcp' || toolset.startsWith('mcp_') || toolset.startsWith('mcp-')) return 'mcp'
  return 'other'
}

function buildResult(name: string, data: Record<string, unknown>, content: unknown, error: string | null): ToolResultView {
  const preview = previewOf(content)
  const flags = readFlags(data, content)
  const text = preview.text
  return {
    exitCode: readExit(data, content),
    truncated: flags.truncated,
    fullOutputPath: flags.fullOutputPath,
    rawChars: text != null ? text.length : null,
    error,
    summary: error ? null : summarize(name, preview),
  }
}

function summarize(name: string, preview: {text: string | null; lines: number; searchCount: number | null}): string | null {
  if (preview.searchCount != null) return `${preview.searchCount} 条结果`
  if (preview.text == null) return null
  if (name === 'shell_execute' || name.startsWith('shell_')) {
    return preview.lines > 0 ? `${preview.lines} 行输出` : null
  }
  if (BYTE_SUMMARY.has(name)) return `${preview.text.length} 字节`
  if (preview.text.includes('\n')) return `${preview.lines} 行`
  return preview.text.length > 0 ? `${preview.text.length} 字节` : null
}

function previewOf(content: unknown): {text: string | null; lines: number; searchCount: number | null} {
  if (typeof content === 'string') return {text: content, lines: lineCount(content), searchCount: null}
  if (!isRecord(content)) return {text: null, lines: 0, searchCount: null}
  if (typeof content.content === 'string') return {text: content.content, lines: lineCount(content.content), searchCount: null}
  const output = shellOutput(content)
  if (output != null) return {text: output, lines: lineCount(output), searchCount: null}
  if (Array.isArray(content.results)) return {text: null, lines: 0, searchCount: content.results.length}
  return {text: null, lines: 0, searchCount: null}
}

function shellOutput(content: Record<string, unknown>): string | null {
  const records = content.console
  if (typeof records === 'string') return records
  if (!Array.isArray(records) || records.length === 0) return null
  const last = records[records.length - 1]
  if (!isRecord(last)) return null
  return typeof last.output === 'string' ? last.output : null
}

const DENIED_TEXT: Record<string, string> = {
  user: '你拒绝了这次调用，它没有执行',
  policy: '工具策略禁止这次调用，它没有执行',
  plan_mode: '计划模式下不执行',
}

function failureOf(data: Record<string, unknown>, content: unknown): {status: ToolCallStatus; error: string | null} | null {
  const deniedBy = str(data.denied_by)
  if (deniedBy === 'batch') return {status: 'skipped', error: messageOf(data, content) ?? '前序调用失败，本次未执行'}
  if (deniedBy) return {status: 'denied', error: DENIED_TEXT[deniedBy] ?? '调用被拒绝，没有执行'}
  const explicit = str(data.disposition) ?? str(data.outcome_kind)
  if (explicit === 'denied' || explicit === 'rejected') return {status: 'denied', error: messageOf(data, content)}
  if (explicit === 'skipped') return {status: 'skipped', error: messageOf(data, content)}
  if (explicit === 'cancelled' || explicit === 'canceled') return {status: 'cancelled', error: messageOf(data, content)}
  if (readSuccess(data, content) !== false) return null
  const message = messageOf(data, content) ?? '调用失败'
  if (/拒绝/.test(message)) return {status: 'denied', error: message}
  if (/未执行/.test(message)) return {status: 'skipped', error: message}
  if (/执行中断|已取消|已停止/.test(message)) return {status: 'cancelled', error: message}
  return {status: 'failed', error: message}
}

function readSuccess(data: Record<string, unknown>, content: unknown): boolean | null {
  if (typeof data.success === 'boolean') return data.success
  const result = isRecord(data.function_result) ? data.function_result : null
  if (result && typeof result.success === 'boolean') return result.success
  if (isRecord(content)) {
    const outcome = isRecord(content.outcome) ? content.outcome : null
    if (outcome && typeof outcome.success === 'boolean') return outcome.success
  }
  return null
}

function messageOf(data: Record<string, unknown>, content: unknown): string | null {
  const result = isRecord(data.function_result) ? data.function_result : null
  const fromResult = result ? str(result.message) : null
  if (fromResult) return fromResult
  if (isRecord(content)) {
    const outcome = isRecord(content.outcome) ? content.outcome : null
    const fromOutcome = outcome ? str(outcome.message) : null
    if (fromOutcome) return fromOutcome
  }
  return str(data.error)
}

function readFlags(data: Record<string, unknown>, content: unknown): {truncated: boolean; fullOutputPath: string | null} {
  const bags: Array<Record<string, unknown>> = [data]
  if (isRecord(content)) bags.push(content)
  const result = isRecord(data.function_result) ? data.function_result : null
  if (result) {
    bags.push(result)
    if (isRecord(result.data)) bags.push(result.data)
  }
  let truncated = false
  let fullOutputPath: string | null = null
  for (const bag of bags) {
    if (bag.truncated === true) truncated = true
    const path = str(bag.full_output_path) ?? str(bag.fullOutputPath)
    if (path) fullOutputPath = path
  }
  return {truncated, fullOutputPath}
}

function readExit(data: Record<string, unknown>, content: unknown): number | null {
  const bags: Array<Record<string, unknown>> = [data]
  if (isRecord(content)) bags.push(content)
  const result = isRecord(data.function_result) ? data.function_result : null
  if (result && isRecord(result.data)) bags.push(result.data)
  for (const bag of bags) {
    const code = num(bag.exit_code ?? bag.exitCode ?? bag.returncode)
    if (code != null) return code
  }
  return null
}

function readArgs(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data.args ?? data.function_args
  if (isRecord(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      return {}
    }
  }
  return {}
}

function readFiles(raw: unknown, source: 'upload' | 'delivery'): FileView[] {
  if (!Array.isArray(raw)) return []
  const files: FileView[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const filename = str(item.filename) ?? ''
    const id = str(item.id) ?? str(item.file_id) ?? filename
    if (!id && !filename) continue
    let extension = str(item.extension) ?? ''
    if (!extension && filename.includes('.')) extension = filename.slice(filename.lastIndexOf('.'))
    if (extension && !extension.startsWith('.')) extension = `.${extension}`
    const path = str(item.filepath) ?? str(item.path)
    files.push({
      id,
      filename,
      size: num(item.size),
      extension,
      contentType: str(item.mime_type) ?? str(item.content_type) ?? str(item.contentType) ?? '',
      source,
      path: path || null,
      projectPersistence: isRecord(item.project_persistence) ? {
        state: str(item.project_persistence.state) ?? 'pending',
        copy_key: str(item.project_persistence.copy_key) ?? '',
        path: str(item.project_persistence.path), error: str(item.project_persistence.error),
        can_retry: item.project_persistence.can_retry === true,
      } : undefined,
    })
  }
  return files
}

function addFile(files: FileView[], file: FileView) {
  const index = files.findIndex((item) => item.id === file.id)
  if (index < 0) files.push(file)
  else if (file.source === 'delivery') files[index] = file
}

function pushNarration(timeline: TimelineItem[], msg: PendingText) {
  if (!msg.text.trim()) return
  timeline.push({
    kind: 'narration',
    id: idOf(msg.seq, timeline.length),
    runId: msg.runId,
    at: msg.at,
    text: msg.text,
    turnIndex: msg.turnIndex,
  })
}

function answerLatestAsk(timeline: TimelineItem[], runId: string | null) {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i]
    if (item.kind === 'ask' && item.runId === runId && !item.answered) {
      timeline[i] = {...item, answered: true}
      return
    }
  }
}

function patchFinal(timeline: TimelineItem[], runId: string, summary: RunSummary | null) {
  if (!summary) return
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i]
    if (item.kind === 'final' && item.runId === runId) {
      timeline[i] = {...item, summary}
      return
    }
  }
}

function firstUserText(timeline: TimelineItem[], runId: string): string | null {
  for (const item of timeline) {
    if (item.kind === 'user' && item.runId === runId && !item.injected && item.text) return item.text
  }
  return null
}

function primitivePairs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value != null && typeof value !== 'object')
    .map(([key, value]) => `${key}=${String(value)}`)
  return clip(parts.join(' '), 120)
}

function basename(path: string): string {
  const cut = path.split(/[/\\]/).filter(Boolean)
  return cut[cut.length - 1] ?? path
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max)}…`
}

function lineCount(text: string): number {
  if (!text) return 0
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.length
}

function idOf(seq: number | null, fallback: number): string {
  return seq != null ? `e${seq}` : `e-n${fallback}`
}

function asRunStatus(value: unknown): RunStatus | null {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value) ? value as RunStatus : null
}

function asApprovalStatus(value: unknown): ApprovalStatus {
  return value === 'approved' || value === 'rejected' || value === 'expired' ? value : 'pending'
}

/** 审批失效：调用没有执行，不再按运行终态推断为“结果未知” */
function markExpired(liveCalls: LiveCall[], key: string) {
  const live = liveCalls.find((item) => `${item.runId ?? ''}:${item.view.callId}` === key)
  if (!live || live.view.status !== 'running') return
  live.view.status = 'skipped'
  live.view.result = {exitCode: null, truncated: false, fullOutputPath: null, rawChars: null, error: '审批已失效，这次调用没有执行', summary: null}
}

function asToolStatus(value: string | null): ToolCallStatus | null {
  if (value === 'running' || value === 'succeeded' || value === 'failed' || value === 'denied' || value === 'skipped' || value === 'cancelled') {
    return value
  }
  return null
}

function estimateTotal(raw: unknown): number | null {
  if (!isRecord(raw)) return null
  return num(raw.total)
}

function asCompactTrigger(value: unknown): CompactTrigger | null {
  return value === 'watermark' || value === 'overflow' || value === 'manual' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}


/** 最新计划运行确实产出带身份的可执行清单，才提供后续执行。 */
export function canExecutePlan(view: Pick<SessionView, 'activeRun' | 'runs' | 'plan'>): boolean {
  const run = view.runs[view.runs.length - 1]
  const plan = view.plan
  return !view.activeRun && run?.status === 'completed' && run.mode === 'plan'
    && !!plan?.planId && plan.sourceRunId === run.id
    && plan.updatedAt >= run.startedAt && run.endedAt != null && plan.updatedAt <= run.endedAt
    && plan.items.some((item) => item.text.trim() && item.status !== 'completed')
}
