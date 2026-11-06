/* 由 ray_agent/contracts 从 events.schema.json 生成，勿手改；改 Pydantic 契约后运行 npm run generate。 */

/**
 * 会话事件信封：SessionEvent 为落库事件，StreamEvent 另含文本增量
 */
export type RayAgentEvents = StreamEvent | SessionEvent;
export type StreamEvent =
  | MessageSSEEvent
  | TitleSSEEvent
  | StepSSEEvent
  | PlanSSEEvent
  | ToolSSEEvent
  | DoneSSEEvent
  | ErrorSSEEvent
  | WaitSSEEvent
  | TurnSSEEvent
  | AttemptSSEEvent
  | RunSSEEvent
  | EnvironmentSSEEvent
  | ContextSSEEvent
  | CompactSSEEvent
  | CleanupSSEEvent
  | ApprovalSSEEvent
  | DeltaSSEEvent;
/**
 * 运行身份；一个会话至多一个活动运行
 */
export type RunId = string;
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
/**
 * 工具事件状态类型枚举
 */
export type ToolEventStatus = "calling" | "called";
/**
 * 运行状态。running/waiting 是活动状态，其余是终态，终态不可再改。
 */
export type RunStatus = "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
/**
 * 运行模式：只在新建运行时由 chat 选择，续接沿用。
 */
export type RunMode = "normal" | "plan";
/**
 * 会话身份
 */
export type SessionId = string;
export type SessionEvent =
  | MessageSSEEvent
  | TitleSSEEvent
  | StepSSEEvent
  | PlanSSEEvent
  | ToolSSEEvent
  | DoneSSEEvent
  | ErrorSSEEvent
  | WaitSSEEvent
  | TurnSSEEvent
  | AttemptSSEEvent
  | RunSSEEvent
  | EnvironmentSSEEvent
  | ContextSSEEvent
  | CompactSSEEvent
  | CleanupSSEEvent
  | ApprovalSSEEvent;

/**
 * 流式消息事件数据响应结构
 */
export interface MessageSSEEvent {
  event: "message";
  data: MessageEventData;
}
/**
 * 消息事件数据
 */
export interface MessageEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  role: "user" | "assistant";
  message: string;
  attachments: File[];
  skill: SkillSelection | null;
  image_mode: "auto" | "files";
  attempt: number | null;
}
/**
 * 文件信息Domain模型，用于记录用户上传或 Agent 交付的文件；字节保存为数据根中的内容对象
 */
export interface File {
  id?: string;
  filename?: string;
  filepath?: string;
  key?: string;
  extension?: string;
  mime_type?: string;
  size?: number;
  sha256?: string | null;
  visual?: {
    [k: string]: unknown;
  } | null;
}
export interface SkillSelection {
  id: string;
  version: string;
}
/**
 * 标题流式事件
 */
export interface TitleSSEEvent {
  event: "title";
  data: TitleEventData;
}
/**
 * 标题事件数据
 */
export interface TitleEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  title: string;
}
/**
 * 步骤流式事件
 */
export interface StepSSEEvent {
  event: "step";
  data: StepEventData;
}
/**
 * 步骤事件数据
 */
export interface StepEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  id: string;
  status: ExecutionStatus;
  description: string;
  kind: string;
  parent_id: string | null;
  schedule: string;
  reason: string;
}
/**
 * 计划流式事件
 */
export interface PlanSSEEvent {
  event: "plan";
  data: PlanEventData;
}
export interface PlanEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  plan_id: string;
  title: string;
  description: string;
  goal: string;
  scope: string;
  artifacts: {
    [k: string]: unknown;
  }[];
  progress_state: string;
  review_only: boolean;
  accepted_from: PlanAcceptance | null;
  explanation: string;
  steps: StepEventData[];
}
export interface PlanAcceptance {
  source_run_id: string;
  plan_id: string;
  source_seq: number;
  request_id: string;
}
/**
 * 工具流式事件
 */
export interface ToolSSEEvent {
  event: "tool";
  data: ToolEventData;
}
/**
 * 工具事件数据
 */
export interface ToolEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  tool_call_id: string;
  name: string;
  status: ToolEventStatus;
  function: string;
  args: {
    [k: string]: unknown;
  };
  content: unknown;
  duration_ms: number | null;
  stages_ms: {
    [k: string]: number;
  };
  shaping: ToolResultShaping | null;
  denied_by:
    ("policy" | "user" | "plan_mode" | "budget" | "batch" | "verification_cache" | "verification_limit") | null;
}
/**
 * 结果整形元数据：结果序列化后超过单条上限时，进入上下文的只是首尾预览。
 */
export interface ToolResultShaping {
  original_chars: number;
  preview_chars: number;
  truncated?: boolean;
  full_output_path?: string | null;
  error?: string | null;
}
/**
 * 停止流式事件
 */
export interface DoneSSEEvent {
  event: "done";
  data: DoneEventData;
}
export interface DoneEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  outcome: string;
  missing: string[];
}
/**
 * 错误流式事件
 */
export interface ErrorSSEEvent {
  event: "error";
  data: ErrorEventData;
}
/**
 * 错误事件数据
 */
export interface ErrorEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  error: string;
  context_estimate: {
    [k: string]: unknown;
  } | null;
  fixed_input_exceeded: boolean;
}
/**
 * 等待人类输入流式事件
 */
export interface WaitSSEEvent {
  event: "wait";
  data: BaseEventData;
}
/**
 * 信封的公共元数据。seq 是会话内序号（SSE 的 id），created_at 是毫秒时间戳。
 */
export interface BaseEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
}
/**
 * 轮次边界流式事件
 */
export interface TurnSSEEvent {
  event: "turn";
  data: TurnEventData;
}
/**
 * 轮次边界事件数据，字段含义见领域模型 TurnEvent。
 */
export interface TurnEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  phase: "started" | "completed";
  index: number;
  context_estimate: {
    [k: string]: unknown;
  } | null;
  context_window: number | null;
  model_ms: number | null;
  attempts: number | null;
  ttft_ms: number | null;
  usage: TurnUsage | null;
  finish_reason: string | null;
  tool_call_ids: string[];
  tools_ms: number | null;
  error: string | null;
}
/**
 * 一轮内返回了响应的各次尝试的用量合计；服务未返回的项为空。
 */
export interface TurnUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cached_tokens?: number | null;
  reasoning_tokens?: number | null;
}
/**
 * 失败尝试流式事件
 */
export interface AttemptSSEEvent {
  event: "attempt";
  data: AttemptEventData;
}
/**
 * 失败的模型请求。reason 是稳定代码，chars 是已推送的文本字符数。
 */
export interface AttemptEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  turn: number;
  attempt: number;
  reason: string;
  chars: number;
  retried: boolean;
}
/**
 * 运行状态流式事件
 */
export interface RunSSEEvent {
  event: "run";
  data: RunEventData;
}
/**
 * 运行状态变化事件数据；终态时 summary 为运行汇总，mode 为运行模式（normal / plan）。
 */
export interface RunEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  status: RunStatus;
  reason: string | null;
  summary: {
    [k: string]: unknown;
  } | null;
  mode: RunMode | null;
}
export interface EnvironmentSSEEvent {
  event: "environment";
  data: EnvironmentEventData;
}
export interface EnvironmentEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  status: "preparing" | "ready";
  message: string | null;
}
/**
 * 模型历史变化流式事件
 */
export interface ContextSSEEvent {
  event: "context";
  data: ContextEventData;
}
/**
 * 模型历史变化的轻量投影：消息全文只在数据库与请求重建接口里，推送时只给条数与角色。
 */
export interface ContextEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  op: "append" | "strip_reasoning" | "replace";
  message_count: number;
  roles: string[];
}
/**
 * 压缩流式事件
 */
export interface CompactSSEEvent {
  event: "compact";
  data: CompactEventData;
}
/**
 * 压缩事件数据，字段含义见领域模型 CompactEvent；摘要全文随事件推送，供开发者视图显示。manual 时 run_id 为空。
 */
export interface CompactEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  trigger: "watermark" | "overflow" | "manual";
  before_estimate: {
    [k: string]: unknown;
  };
  after_estimate: {
    [k: string]: unknown;
  };
  summarized_turns: number;
  kept_turns: number;
  summary: string;
  reinjected_event_seqs: number[];
  omitted_user_messages: number;
  usage: CompactUsage;
}
/**
 * 摘要请求各次尝试的用量合计；属于运行时计入运行的模型请求数与 tokens，不算一轮。
 */
export interface CompactUsage {
  attempts?: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cached_tokens?: number | null;
}
export interface CleanupSSEEvent {
  event: "cleanup";
  data: CleanupEventData;
}
/**
 * 停止后的收尾结果，失败不改变运行终态。
 */
export interface CleanupEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  targets: CleanupTarget[];
}
export interface CleanupTarget {
  kind?: "shell" | "a2a" | "browser";
  id: string;
  success: boolean;
  message?: string;
}
/**
 * 工具级审批流式事件
 */
export interface ApprovalSSEEvent {
  event: "approval";
  data: ApprovalEventData;
}
/**
 * 工具级审批。字段名与工具事件一致（name 为工具集、function 为函数名、args 为参数）；decided_at 为毫秒时间戳。
 */
export interface ApprovalEventData {
  event_id: string | null;
  seq: number | null;
  run_id: RunId | null;
  created_at: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  tool_call_id: string;
  name: string;
  function: string;
  args: {
    [k: string]: unknown;
  };
  status: "pending" | "approved" | "rejected" | "expired";
  rule: string | null;
  service: string | null;
  service_tool: string | null;
  decided_at: number | null;
}
export interface DeltaSSEEvent {
  event: "delta";
  data: DeltaEventData;
}
/**
 * 文本增量：不落库，没有 seq，重连不补发；按 (run_id, turn, attempt) 拼接。
 */
export interface DeltaEventData {
  session_id: SessionId;
  run_id: RunId;
  turn: number;
  attempt: number;
  delta: string;
  /**
   * 事件结构版本
   */
  event_version: number;
}
