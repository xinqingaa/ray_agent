/**
 * API 统一响应格式
 */
export type ApiResponse<T = unknown> = {
  code: number;
  msg: string;
  data: T | null;
};

/**
 * 会话状态
 */
export type SessionStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

/** 运行状态；会话状态冗余为最近一次运行的状态 */
export type RunStatus = Exclude<SessionStatus, "pending">;

/** 最近一次运行已进入终态，同一会话仍可再发消息 */
export function isSessionFinished(status?: SessionStatus | string | null): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

/** waiting 或终态：运行不再推进，等待用户输入 */
export function isRunSettled(status?: string | null): boolean {
  return status === "waiting" || isSessionFinished(status);
}

/**
 * 执行状态
 */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed";

/**
 * 工具事件状态
 */
export type ToolEventStatus = "calling" | "called";

/**
 * MCP 传输类型
 */
export type MCPTransport = "stdio" | "streamable_http";

// ==================== 配置模块类型 ====================

/**
 * LLM 配置
 */
export type LLMConfig = {
  base_url?: string;
  model_name?: string;
  temperature?: number;
  max_tokens?: number;
  context_window?: number;
  has_api_key?: boolean;
};

/**
 * Agent 通用配置
 */
export type AgentConfig = {
  max_iterations?: number;
  max_retries?: number;
  max_search_results?: number;
  [key: string]: unknown;
};

/**
 * MCP 服务器列表项（GET 响应）
 */
export type ConnectionState = {
  connection_status: "connected" | "disabled" | "unavailable";
  error: string | null;
};

export type ProtocolOutcome = {
  success: boolean;
  message: string | null;
  data: unknown;
};

export type ListMCPServerItem = ConnectionState & {
  server_name: string;
  enabled: boolean;
  transport: MCPTransport;
  tools: string[];
};

/**
 * MCP 服务器列表响应
 */
export type MCPServersData = {
  mcp_servers: ListMCPServerItem[];
};

/**
 * MCP 服务器配置（POST 请求体中单个服务器的配置）
 */
export type MCPServerConfig = {
  transport?: MCPTransport;
  enabled?: boolean;
  description?: string | null;
  env?: Record<string, string>;
  command?: string | null;
  args?: string[];
  url?: string | null;
  headers?: Record<string, string>;
  connect_timeout?: number;
  discovery_timeout?: number;
  call_timeout?: number;
  [key: string]: unknown;
};

/**
 * MCP 配置（POST 新增 MCP 服务的请求体）
 */
export type MCPConfig = {
  mcpServers: Record<string, MCPServerConfig>;
  [key: string]: unknown;
};

/**
 * A2A 服务器列表项（GET 响应）
 */
export type ListA2AServerItem = ConnectionState & {
  base_url: string;
  id: string;
  name: string;
  description: string;
  input_modes: string[];
  output_modes: string[];
  streaming: boolean;
  push_notifications: boolean;
  enabled: boolean;
};

/**
 * A2A 服务器列表响应
 */
export type A2AServersData = {
  a2a_servers: ListA2AServerItem[];
};

/**
 * 新增 A2A 服务器请求参数
 */
export type CreateA2AServerParams = {
  base_url: string;
};

// ==================== 文件模块类型 ====================

/**
 * 文件信息
 */
export type FileInfo = {
  id: string;
  filename: string;
  filepath: string;
  key: string;
  extension: string;
  content_type: string;
  size: number;
  [key: string]: unknown;
};

/**
 * 文件上传请求参数
 */
export type FileUploadParams = {
  file: File;
  session_id?: string;
};

// ==================== 会话模块类型 ====================

/**
 * 会话信息
 */
export type Session = {
  session_id: string;
  title: string;
  latest_message: string;
  latest_message_at: string;
  status: SessionStatus;
  unread_message_count: number;
  [key: string]: unknown;
};

/**
 * 会话列表响应
 */
export type SessionsData = {
  sessions: Session[];
};

/**
 * 创建会话请求参数
 */
export type CreateSessionParams = {
  title?: string;
  [key: string]: unknown;
};

/**
 * 聊天消息
 */
export type ChatMessage = {
  role: "user" | "assistant" | "system";
  message: string;
  attachments?: Array<{
    file_id: string;
    filename: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

/**
 * 聊天请求参数；事件通过 GET /sessions/:id/events 订阅
 */
export type ChatParams = {
  message: string;
  attachments?: string[];
  [key: string]: unknown;
};

/**
 * chat 受理结果：消息写入的运行、消息事件 seq 与路由方式
 */
export type ChatAccepted = {
  run_id: string;
  seq: number;
  route: "started" | "injected" | "resumed";
};

/**
 * 某一轮实际发给模型的请求（只读重建）
 */
export type TurnRequest = {
  run_id: string;
  index: number;
  turn_seq: number;
  messages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
};

/**
 * 运行记录（时间为毫秒时间戳）
 */
export type RunItem = {
  run_id: string;
  status: RunStatus;
  reason?: string | null;
  turns: number;
  model_requests: number;
  tool_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number | null;
  started_at: number;
  ended_at?: number | null;
  [key: string]: unknown;
};

/**
 * 会话详情：运行列表、按 seq 升序的事件与最后一条事件的 seq
 */
export type SessionDetail = Session & {
  runs?: RunItem[];
  events?: SSEEventData[];
  last_seq?: number;
};

/** 所有持久化事件共有的字段 */
export type EventMeta = {
  event_id?: string;
  seq?: number;
  run_id?: string | null;
  created_at?: number;
};

/**
 * 计划步骤
 */
export type PlanStep = {
  id: string;
  description: string;
  status: ExecutionStatus;
  [key: string]: unknown;
};

/**
 * 计划事件
 */
export type PlanEvent = {
  steps: PlanStep[];
  [key: string]: unknown;
};

/**
 * 步骤事件
 */
export type StepEvent = {
  id: string;
  status: ExecutionStatus;
  description: string;
  [key: string]: unknown;
};

/**
 * 工具调用事件
 */
export type ToolEvent = {
  name: string;
  function: string;
  args: Record<string, unknown>;
  content?: unknown;
  status?: ToolEventStatus;
  [key: string]: unknown;
};

export type TokenUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cached_tokens?: number | null;
  reasoning_tokens?: number | null;
};

/**
 * 模型轮次事件：started 在请求前，completed 在响应或失败后
 */
export type TurnEvent = {
  phase: "started" | "completed";
  index: number;
  context_estimate?: Record<string, unknown> | null;
  context_window?: number | null;
  model_ms?: number | null;
  attempts?: number | null;
  usage?: TokenUsage | null;
  finish_reason?: string | null;
  tool_call_ids?: string[];
  tools_ms?: number | null;
  error?: string | null;
  [key: string]: unknown;
};

/**
 * 运行状态事件；终态附带汇总
 */
export type RunEvent = {
  status: RunStatus;
  reason?: string | null;
  summary?: Record<string, number | null> | null;
  [key: string]: unknown;
};

/** 由 turn 事件推导的用量展示数据 */
export type UsageEvent = {
  agent?: string;
  available: boolean;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  session_prompt_tokens?: number;
  session_completion_tokens?: number;
  session_total_tokens?: number;
  turn_prompt_tokens?: number;
  turn_completion_tokens?: number;
  turn_total_tokens?: number;
  context_window?: number | null;
  [key: string]: unknown;
};

/**
 * SSE 事件类型
 */
export type SSEEventType =
  | "message"
  | "title"
  | "plan"
  | "step"
  | "tool"
  | "wait"
  | "done"
  | "error"
  | "turn"
  | "run"
  | "context"
  | "cleanup"
  | "attempt"
  | "delta";

/**
 * SSE 事件数据
 */
export type SSEEventData =
  | { type: "message"; data: ChatMessage }
  | { type: "title"; data: { title: string } }
  | { type: "plan"; data: PlanEvent }
  | { type: "step"; data: StepEvent }
  | { type: "tool"; data: ToolEvent }
  | { type: "wait"; data: Record<string, unknown> }
  | { type: "done"; data: Record<string, unknown> }
  | { type: "error"; data: { error: string } }
  | { type: "turn"; data: TurnEvent }
  | { type: "run"; data: RunEvent }
  | { type: "context"; data: Record<string, unknown> }
  | { type: "cleanup"; data: Record<string, unknown> }
  | { type: "attempt"; data: Record<string, unknown> }
  | {
      type: "delta";
      data: { session_id?: string; run_id: string; turn: number; attempt: number; delta: string };
    };

/**
 * SSE 事件处理器
 */
export type SSEEventHandler = (event: SSEEventData) => void;

/**
 * 会话文件信息
 */
export type SessionFile = {
  id: string;
  filename: string;
  filepath: string;
  key: string;
  extension: string;
  content_type: string;
  size: number;
  [key: string]: unknown;
};

/**
 * 查看文件内容请求参数
 */
export type ViewFileParams = {
  filepath: string;
  [key: string]: unknown;
};

/**
 * 查看 Shell 输出请求参数
 */
export type ViewShellParams = {
  shell_session_id: string;
  [key: string]: unknown;
};

