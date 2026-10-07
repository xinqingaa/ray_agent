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
export type ModelSampling = {
  temperature: number;
  max_tokens: number;
  context_window: number;
};

export type LLMConfig = {
  base_url?: string;
  model_name?: string;
  temperature?: number;
  max_tokens?: number;
  context_window?: number;
  model_profiles?: Record<string, ModelSampling>;
  has_api_key?: boolean;
};

/**
 * Agent 通用配置
 */
export type AgentConfig = {
  max_iterations?: number;
  max_retries?: number;
  max_search_results?: number;
  project_snapshot_retention?: number;
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
  project_persistence?: {state: string; copy_key: string; path?: string | null; error?: string | null; can_retry: boolean};
};

/**
 * 文件上传请求参数
 */
export type FileUploadParams = {
  file: File;
  session_id?: string;
  project_id?: string;
  rule_version?: string;
  include_optional?: boolean;
};

// ==================== 本地项目模块类型 ====================

export type ProjectView = {
  id: string;
  name: string;
  available: boolean;
  reason?: string | null;
  archived?: boolean;
  occupying_session_id?: string | null;
  active_run_status?: string | null; active_run_reason?: string | null;
  task_count?: number;
  last_active_at?: string | null;
  files_size?: number; files_size_at?: string | null; files_size_stale?: boolean;
  protection?: ProjectProtection | null; file_operation?: ProjectFileOperation | null; write_blocked_reason?: string | null;
  snapshot_gc_pending?: boolean; snapshots_cleaned_at?: string | null; snapshots_released_bytes?: number;

};

export type ProjectFileOperation = {
  operation_id: string; kind: 'settling' | 'upload' | 'snapshot' | 'restore' | 'cleanup' | 'delivery';
  state: 'running' | 'failed'; phase: string; error: string | null;
  run_id: string | null; session_id: string | null;
  target_snapshot_id: string | null; before_snapshot_id: string | null;
  started_at: string; last_active_at: string; results: Record<string, unknown>;
};
export type ProjectProtection = {state: 'ready' | 'skipped' | 'failed'; reason?: string; error?: string; snapshot_id?: string; run_id?: string};
export type ProjectSnapshot = {id: string; project_id: string; source: 'run' | 'upload' | 'restore'; run_id: string | null; session_id: string | null; total_bytes: number; manifest_sha256: string; created_at: string};
export type ProjectAuditEvent = {seq: number; type: string; payload: Record<string, unknown>; created_at: string};
export type ProjectUploadRules = {
  version: string; max_batch_bytes: number; max_files: number; max_file_bytes: number; max_project_bytes: number;
  always_exclude: string[]; dependency_directories: string[]; conditional_directories: Record<string, string[]>;
  sensitive_patterns: string[]; venv_marker: string; preserve_empty_directories: boolean;
  idle_timeout_seconds: number; total_timeout_seconds: number;
};
export type ProjectUploadItem = {path: string; size: number; sha256: string; overwrite: boolean};
export type ProjectUploadSelection = {rule_version: string; items: ProjectUploadItem[]; include_optional: string[]; inventory: string[]; fingerprint: Record<string, unknown>};
export type ProjectUploadPreflight = {rule_version: string; items: Array<ProjectUploadItem & {included: boolean; reuse: boolean; conflict?: boolean; policy: string; reason?: string; confirmation_path?: string}>; fingerprint: Record<string, unknown>; current_bytes: number; projected_bytes: number; upload_bytes: number; upload_count: number; warnings: Array<{path: string; case_conflicts: string[]}>; errors: string[]; empty_directories: string};
export type ProjectUploadResult = {path: string; size?: number; sha256?: string; published: boolean; reused?: boolean; error?: string};
export type ProjectOperationResult = {operation_id: string; kind?: string; state?: string; status?: string; phase?: string; error?: string | null; results: {received?: Record<string, ProjectUploadResult>; failures?: Record<string, string>; batch_status?: string; [key: string]: unknown}};

export type ProjectSettings = {name: string; instructions: string | null};
export type ProjectUpdate = ProjectSettings & {settings_version: number; notes?: string; notes_version?: number};
export type ProjectDetails = ProjectView & ProjectSettings & {notes: string; notes_version: number; settings_version: number; created_at: string; updated_at: string; archived_at: string | null; occupying_session_id: string | null};
export type ProjectPage = {projects: ProjectView[]; total: number; offset: number; limit: number};

export type ProjectEntryType = "file" | "directory" | "symlink" | "other";
export type ProjectLinkState = "inside" | "outside" | "broken";

export type ProjectTreeEntry = {
  name: string;
  path: string;
  type: ProjectEntryType;
  size?: number | null;
  modified_at?: number | null;
  is_symlink: boolean;
  link?: ProjectLinkState | null;
};

export type ProjectListing = {
  path: string;
  entries: ProjectTreeEntry[];
  total: number;
  truncated: boolean;
  limit: number;
};

export type ProjectFileKind = "text" | "binary" | "too_large" | "symlink" | "other";

export type ProjectFile = {
  path: string;
  name: string;
  size: number;
  modified_at?: number | null;
  kind: ProjectFileKind;
  content?: string | null;
  max_bytes: number;
};

// ==================== 会话模块类型 ====================

/**
 * 会话信息
 */
export type ConversationSummary = {
  summary: string | null; summary_source: 'auto' | 'manual' | null;
  summary_state: 'idle' | 'generating' | 'ready' | 'failed'; summary_error: string | null;
  summary_generation: number; summary_source_seq: number;
};

export type Session = Partial<ConversationSummary> & {
  session_id: string;
  title: string;
  latest_message: string;
  latest_message_at: string;
  status: SessionStatus;
  unread_message_count: number;
  project?: ProjectView | null;
  [key: string]: unknown;
};

/**
 * 会话列表响应
 */
export type SessionsData = {
  sessions: Session[];
  total: number;
  offset: number;
  limit: number;
};

/**
 * 创建会话请求参数
 */
export type CreateSessionParams = {
  project_id?: string;
  creation_id?: string;
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
  mode?: "normal" | "plan";
  model?: string;
  reasoning?: string;
  [key: string]: unknown;
};

export type ModelCatalog = {
  provider: string | null;
  default_model: string | null;
  models: Array<{
    id: string;
    context_window: number;
    max_output: number;
    choices: string[];
    default_choice: string;
  }>;
};

export type CompactResult = {
  status: "compacted" | "skipped";
  reason?: string | null;
  message: string;
  compact_seq?: number | null;
  context_seq?: number | null;
  before_total?: number | null;
  after_total?: number | null;
  summarized_turns?: number | null;
  kept_turns?: number | null;
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
  context_config?: {context_window: number; max_tokens: number; limit: number; watermark: number};
  context_operation?: {status: "idle" | "compacting"; started_at: string | null};
  model_id?: string | null;
  reasoning?: string | null;
  run_model?: string | null;
  run_reasoning?: string | null;
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
  /** 未执行：被工具策略禁止 / 被用户拒绝，只在 called 上；有值时 content 为空 */
  denied_by?: "policy" | "user" | null;
  [key: string]: unknown;
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/**
 * 工具级审批事件：同一调用先有 pending，再有一条结论。
 * name / function / args 与工具事件同义；MCP 的 function 是哈希别名，展示用 service + service_tool。
 */
export type ApprovalEvent = {
  tool_call_id: string;
  name: string;
  function: string;
  args: Record<string, unknown>;
  status: ApprovalStatus;
  /** 命中的策略规则键 */
  rule?: string | null;
  /** MCP 服务名或 A2A 远程 Agent id */
  service?: string | null;
  /** MCP 服务端原始工具名；A2A 为 call_remote_agent */
  service_tool?: string | null;
  /** 毫秒时间戳 */
  decided_at?: number | null;
  [key: string]: unknown;
};

/** 审批受理结果：seq 是结论事件的序号，续接过程从事件流观察 */
export type ApprovalAccepted = {
  run_id: string;
  seq: number;
  status: "approved" | "rejected";
};

export type ApprovalDecision = "approve" | "deny";

// ==================== 工具策略 ====================

export type ToolPolicy = "allow" | "ask" | "deny";

export type BuiltinToolset = {
  toolset: string;
  functions: string[];
};

/**
 * 工具策略表。规则键：内置工具写函数名或 <工具集>:*；
 * MCP 写 mcp:<服务名>:<工具名>、mcp:<服务名>:*、mcp:*；A2A 写 a2a:<id>:call_remote_agent、a2a:<id>:*、a2a:*。
 * 越具体的键优先，未匹配任何规则为 fallback（allow）。
 */
export type ToolPolicyConfig = {
  rules: Record<string, ToolPolicy>;
  default_rules: Record<string, ToolPolicy>;
  fallback: ToolPolicy;
  builtin_toolsets: BuiltinToolset[];
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
  | "environment"
  | "project_notes"
  | "context"
  | "cleanup"
  | "attempt"
  | "approval"
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
  | { type: "environment"; data: EventMeta & { status: "preparing" | "ready"; message?: string; project_file_protection?: Record<string, unknown> } }
  | { type: "project_notes"; data: EventMeta & {project_id: string; content: string; notes_version: number; source: "user" | "agent"} }
  | { type: "context"; data: Record<string, unknown> }
  | { type: "cleanup"; data: Record<string, unknown> }
  | { type: "attempt"; data: Record<string, unknown> }
  | { type: "approval"; data: ApprovalEvent }
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
  session_id: string;
  [key: string]: unknown;
};

export type ProjectMemorySummary = {stale?:boolean;latest_seq?:number;session_id:string; title:string; summary:string; source:string; source_seq:number; generation:number; state?:string; error?:string|null; injected_text?:string; truncated?:boolean};
export type ProjectMemorySnapshot = {instructions:string|null; notes:string; settings_version:number; notes_version:number; summaries:ProjectMemorySummary[]};
export type ProjectMemoryCapacity = {total:number;limit:number;over_limit:boolean;model:string;mode:string;tool_count:number;discovery_errors:Record<string,string>;source:string;system_prompt:number;tools:number};
export type ProjectMemoryView = {capacity?:ProjectMemoryCapacity;project:ProjectMemorySnapshot; candidates:ProjectMemorySummary[]; project_prompt:string; frozen:ProjectMemorySnapshot|null; active_run_id:string|null};
