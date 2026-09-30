/**
 * 会话视图模型类型：W4 投影函数的输出，W5 组件只消费这些类型。
 * 字段约定见 docs/plan/w4-ui-data.md 的“视图模型契约”；删改字段需同步契约。
 * 投影函数在 session-projection.ts（`projectSession`）。本文件只有类型。时间一律为毫秒时间戳。
 */

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

/** W3 定义的运行原因；未知取值原样保留 */
export type RunReason =
  | 'max_iterations'
  | 'context_limit'
  | 'output_truncated'
  | 'user_stop'
  | 'api_restart'
  | 'ask'
  | 'approval'
  | (string & {})

export type TokenCounts = {
  prompt: number | null
  completion: number | null
  total: number | null
  cached?: number | null
  /** 供应商把推理 token 计入 completion 时给出；没有则为空 */
  reasoning?: number | null
}

/** W2 的四部分上下文估算（tokens） */
export type ContextEstimate = {
  system: number
  tools: number
  history: number
  toolResults: number
  contextWindow?: number | null
  maxTokens?: number | null
  inputLimit?: number | null
  watermarkTokens?: number | null
  method?: string | null
  includesProjectContext?: boolean
}

export type TurnView = {
  index: number
  startedAt: number
  endedAt: number | null
  modelMs: number | null
  /** 本轮工具批次耗时合计（W3 turn completed 的 tools_ms） */
  toolsMs: number | null
  usage: TokenCounts | null
  finishReason: string | null
  toolCallIds: string[]
  contextEstimate: ContextEstimate | null
  /** W6 */
  ttftMs?: number | null
  /** W6 */
  attempts?: number | null
}

export type RunSummary = {
  durationMs: number
  turns: number
  toolCalls: number
  tokens: TokenCounts
}

export type Activity =
  | {kind: 'preparing_environment'}
  | {kind: 'model'; turnIndex: number; startedAt: number}
  | {kind: 'tool'; callId: string; title: string; family: ToolFamily; startedAt: number}
  | {kind: 'waiting_reply'; question: string}
  | {kind: 'waiting_approval'; callId: string; title: string}
  | {kind: 'stopping'; requestedAt: number}
  | {kind: 'idle'}

export type RunMode = 'normal' | 'plan'

export type RunView = {
  id: string
  status: RunStatus
  /** 运行模式；缺省为 normal */
  mode?: RunMode
  reason: RunReason | null
  /** 投影生成的可读原因，终态非 completed 时必有 */
  reasonText: string | null
  startedAt: number
  endedAt: number | null
  turns: TurnView[]
  /** 本次运行的模型请求上限（AgentConfig.max_iterations 快照） */
  maxTurns: number | null
  /** 终态汇总，运行中为空 */
  summary: RunSummary | null
  /** 运行中的累计用量（各轮之和），供状态条显示 */
  tokens: TokenCounts
  activity: Activity
}

export type ToolFamily =
  | 'file'
  | 'shell'
  | 'browser'
  | 'search'
  | 'mcp'
  | 'a2a'
  | 'plan'
  | 'deliver'
  | 'other'

export type ToolCallStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'skipped' | 'cancelled'

export type ToolResultView = {
  exitCode: number | null
  /** W2 输出整形：交给模型的结果是否被截断 */
  truncated: boolean
  /** W2 输出整形：完整输出保存位置 */
  fullOutputPath: string | null
  /** 原始结果字符数 */
  rawChars: number | null
  /** 失败、被拒绝、未执行、已取消时的说明 */
  error: string | null
  /** 一句话结果摘要，如“29 字节”“2 行输出” */
  summary: string | null
}

export type ToolCallView = {
  callId: string
  family: ToolFamily
  /** 模型调用的函数名，如 read_file */
  name: string
  /** 工具集名，即事件的 name 字段，如 file */
  toolset: string
  /** 面向用户的动词短语：verb + 空格 + target */
  title: string
  /** 动词，如“读取文件” */
  verb: string
  /** 关键参数，如路径或命令；没有则为空串 */
  target: string
  argSummary: string
  status: ToolCallStatus
  startedAt: number
  durationMs: number | null
  result: ToolResultView | null
  raw: {args: Record<string, unknown>; content: unknown}
}

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItem = {
  text: string
  status: PlanItemStatus
  /** 首次变为 in_progress 的时间 */
  startedAt: number | null
  /** 变为 completed 的时间 */
  completedAt: number | null
}

export type PlanChange = {
  /** added、status 为新清单中的下标；removed 为上一版中的下标 */
  index: number
  text: string
  kind: 'added' | 'removed' | 'status'
  from?: PlanItemStatus
  to?: PlanItemStatus
}

export type PlanView = {
  planId?: string | null
  sourceRunId?: string | null
  items: PlanItem[]
  currentIndex: number | null
  completedCount: number
  explanation: string | null
  updatedAt: number
  /** 与上一版相比的变化；第一版为空 */
  changed: PlanChange[]
  /** 已更新的版本数，第一版为 1 */
  version: number
}

export type FileView = {
  id: string
  filename: string
  size: number | null
  extension: string
  contentType: string
  source: 'upload' | 'delivery'
  /** 沙箱内路径；上传文件可能为空 */
  path: string | null
}

/** 会话绑定的本地项目；与 API ProjectView 一致 */
export type ProjectView = import('@/lib/api/types').ProjectView

type ItemBase = {id: string; runId: string | null; at: number}

export type TimelineItem =
  | (ItemBase & {kind: 'user'; text: string; attachments: FileView[]; injected: boolean})
  | (ItemBase & {kind: 'narration'; text: string})
  | (ItemBase & {kind: 'tools'; turnIndex: number | null; calls: ToolCallView[]})
  | (ItemBase & {kind: 'ask'; question: string; answered: boolean})
  | (ItemBase & {kind: 'approval'; call: ToolCallView; status: ApprovalStatus; decidedAt: number | null})
  | (ItemBase & {kind: 'delivery'; files: FileView[]; note: string})
  | (ItemBase & {
      kind: 'compaction'
      beforeTokens: number
      afterTokens: number
      summarizedTurns: number
      summary: string | null
      trigger: 'watermark' | 'overflow' | 'manual'
    })
  | (ItemBase & {kind: 'attempt'; turnIndex: number; attempt: number; reason: string; retried: boolean; chars?: number | null})
  | (ItemBase & {kind: 'final'; text: string; summary: RunSummary | null})
  | (ItemBase & {kind: 'run_end'; status: Exclude<RunStatus, 'running' | 'waiting' | 'completed'>; reason: RunReason | null; reasonText: string; retryText: string | null})

export type TimelineItemKind = TimelineItem['kind']
export type TimelineItemOf<K extends TimelineItemKind> = Extract<TimelineItem, {kind: K}>

/** W7.2 审批条目状态；“提交中”是按钮的临时状态，不在视图模型中 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export type CompactTrigger = 'watermark' | 'overflow' | 'manual'

export type UsageView = {
  /** 会话累计 */
  session: TokenCounts
  /** 最近一次模型请求的上下文占用；尚无请求时为空 */
  context: {
    usedTokens: number
    windowTokens: number
    lastTurnTokens: number | null
    /** 占用来自手动/会话级压缩后的估算，下一次请求后会更新 */
    postCompactEstimate?: boolean
    source?: 'prompt_usage' | 'request_estimate' | 'compact_estimate'
    configChanged?: boolean
    fixedInputExceeded?: boolean
    includesProjectContext?: boolean
    snapshotAt?: number
    inputLimit?: number | null
    maxTokens?: number | null
    safetyTokens?: number | null
    watermarkTokens?: number | null
    inputRemaining?: number | null
    estimate?: ContextEstimate | null
  } | null
  /** 最近一次带估算的压缩事件 */
  lastCompaction?: {
    seq: number
    trigger: CompactTrigger
    beforeTotal: number
    afterTotal: number
    afterEstimate?: ContextEstimate | null
    at?: number
  } | null
  /** W2 压缩水位，占窗口的比例；未知为空 */
  watermarkRatio: number | null
  /** 本会话发生过的压缩次数 */
  compactions: number
}

export type RawEvent = {
  seq: number
  runId: string | null
  type: string
  createdAt: number
  payload: Record<string, unknown>
}

/** 正在增长的临时文本。不落库；刷新、重连或被完整消息替换后消失 */
export type StreamingDraft = {
  itemId: string
  runId: string
  turn: number
  attempt: number
  text: string
  /** 第一个片段的到达时间；调用方传入，投影不读时钟 */
  startedAt: number | null
}

export type SessionView = {
  id: string
  title: string
  /** 最新运行的状态；没有运行时为 idle */
  status: RunStatus | 'idle'
  /** 绑定的本地项目；未绑定为 null */
  project: ProjectView | null
  runs: RunView[]
  activeRun: RunView | null
  timeline: TimelineItem[]
  plan: PlanView | null
  usage: UsageView
  files: FileView[]
  events: RawEvent[]
  /** 正在增长的旁白 id；没有增量时为 null。手写夹具可省略 */
  streamingItemId?: string | null
  /** 与 streamingItemId 对应的临时文本，供速度估算。手写夹具可省略 */
  streaming?: StreamingDraft | null
}
