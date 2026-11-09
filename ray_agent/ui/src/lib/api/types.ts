import type {components} from "@contracts/openapi";
import type {StreamEvent, WorkspaceChangeEvent} from "@contracts/events";

export type {WorkspaceChangeEvent};

// ==================== 契约生成类型 ====================
// 来自 ray_agent/contracts 的生成结果；改动在核心的 Pydantic 模型里进行并重新生成。

type Schemas = components["schemas"];
export type ShellChanges = Schemas['ShellChangesResponse'];

/** 成功响应包装：业务数据在 data，其余字段与契约中的包装一致 */
export type ApiResponse<T = unknown> = Omit<Schemas["Response_Dict_"], "data"> & { data: T };

/** 失败响应：HTTP 状态表达类别，error 为结构化错误 */
export type ErrorResponse = Schemas["ErrorResponse"];
export type ErrorInfo = Schemas["ErrorInfo"];
export type ErrorCode = Schemas["ErrorCode"];

/** 核心状态与能力声明 */
export type CoreStatus = Schemas["CoreStatus"];
export type CapabilityStatus = Schemas["CapabilityStatus"];
export type BuildIdentity = Schemas["BuildIdentity"];

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
export type ExecutionStatus = Schemas["ExecutionStatus"];

/**
 * 工具事件状态
 */
export type ToolEventStatus = Schemas["ToolEventStatus"];

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

/** 模型连接配置文件的读取结果；只含掩码与可用性，不含密钥 */
export type ConnectionSource = Schemas["ConnectionSource"];
export type ProviderStatus = Schemas["ProviderStatus"];

export type LLMConfig = {
  model_name?: string;
  temperature?: number;
  max_tokens?: number;
  context_window?: number;
  model_profiles?: Record<string, ModelSampling>;
  connections?: ConnectionSource | null;
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
  mime_type?: string;
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
export type ConversationSummary = {
  summary: string | null; summary_source: 'auto' | 'manual' | null;
  summary_state: 'idle' | 'generating' | 'ready' | 'failed'; summary_error: string | null;
  summary_generation: number; summary_source_seq: number;
};

export type Session = Partial<ConversationSummary> & {
  session_id: string;
  /** 所属工作区；独立对话为空，创建后不变 */
  workspace_id?: string | null;
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
  total: number;
  offset: number;
  limit: number;
};

/**
 * 创建会话请求参数
 */
export type CreateSessionParams = {
  creation_id?: string;
  workspace_id?: string;
  title?: string;
  [key: string]: unknown;
};

/**
 * 聊天请求参数；事件通过 GET /sessions/:id/events 订阅
 */
export type PlanAcceptance = {source_run_id: string; plan_id: string; source_seq: number; request_id: string};

export type ChatParams = {
  execute_plan?: PlanAcceptance;
  message: string;
  attachments?: string[];
  mode?: "normal" | "plan";
  model?: string;
  reasoning?: string;
  skill?: {id: string; version: string}; image_mode?: 'auto' | 'files';
  [key: string]: unknown;
};

export type ModelCatalog = {
  provider: string | null;
  default_model: string | null;
  models: Array<{
    id: string;
    vendor: string;
    vendor_label: string;
    vision?: boolean;
    context_window: number;
    max_output: number;
    choices: string[];
    default_choice: string;
    reasoning_options: Array<{id: string; enabled: boolean}>;
    reasoning_ordered: boolean;
    reasoning_family: string | null;
    temperature_when: "always" | "disabled" | "never";
    temperature_max: number | null;
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
  api_protocol?: string;
  run_id: string;
  index: number;
  turn_seq: number;
  images?: Record<string, unknown>[];
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

// ==================== 会话事件（契约生成） ====================

/** 前端统一使用 `{type, data}`：type 为信封的 event，data 为信封的 data（含 seq、run_id、created_at 与 event_version） */
type Normalized<E> = E extends { event: infer T; data: infer D } ? { type: T; data: D } : never;

export type SSEEventData = Normalized<StreamEvent>;
export type SSEEventType = SSEEventData["type"];
export type SSEEventOf<T extends SSEEventType> = Extract<SSEEventData, { type: T }>;
type EventData<T extends SSEEventType> = SSEEventOf<T>["data"];

/** 所有持久化事件共有的元数据 */
export type EventMeta = Pick<EventData<"message">, "event_id" | "seq" | "run_id" | "created_at" | "event_version">;
export type ChatMessage = EventData<"message">;
export type PlanEvent = EventData<"plan">;
export type PlanStep = PlanEvent["steps"][number];
export type StepEvent = EventData<"step">;
export type ToolEvent = EventData<"tool">;
/** 工具级审批：同一调用先有 pending，再有一条结论；MCP 的 function 是哈希别名，展示用 service + service_tool */
export type ApprovalEvent = EventData<"approval">;
export type ApprovalStatus = ApprovalEvent["status"];
export type TurnEvent = EventData<"turn">;
export type TokenUsage = NonNullable<TurnEvent["usage"]>;
export type RunEvent = EventData<"run">;

/**
 * SSE 事件处理器
 */
export type SSEEventHandler = (event: SSEEventData) => void;

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
 * 会话文件信息
 */
export type SessionFile = {
  id: string;
  filename: string;
  filepath: string;
  key: string;
  extension: string;
  content_type: string;
  mime_type?: string;
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

export type ContextPreview = {
  model: string; reasoning: string | null; total: number; context_window: number;
  max_tokens: number; limit: number; watermark: number; method: string;
  over_watermark: boolean; over_limit: boolean; fixed_input_exceeded: boolean;
};
export type SamplingBudget = {context_window: number; max_tokens: number; limit: number; watermark: number};

// ==================== 工作区与文件夹 ====================

export type WorkspaceItem = Schemas["WorkspaceItem"];
export type WorkspaceStatus = Schemas["WorkspaceStatus"];
export type FolderView = Schemas["FolderView"];
export type FolderStatus = Schemas["FolderStatus"];
export type OpenWorkspaceResult = Schemas["OpenWorkspaceResult"];
export type MarkerConflict = Schemas["MarkerConflict"];
export type ConflictResolution = Schemas["ConflictResolution"];
export type ScanSummary = Schemas["ScanSummary"];
export type RootEntry = Schemas["RootEntryView"];
export type RootListing = Schemas["RootListing"];
export type OperationView = Schemas["OperationView"];

export type WriteLease = Schemas["WriteLeaseView"];
export type ModifiedRun = Schemas["RunSummaryView"];
export type RunChanges = Schemas["RunChangesResponse"];
export type ChangeEntry = Schemas["ChangeEntryView"];
export type FileVersion = Schemas["FileVersionView"];
export type ChangePreview = Schemas["ChangePreviewResponse"];
export type UndoItemRequest = Schemas["UndoItemRequest"];
export type ForceCurrent = Schemas["ForceCurrentRequest"];
export type UndoItemResult = Schemas["UndoItemResult"];

// ==================== 工作方式与记忆（P5） ====================

export type InstructionView = Schemas["InstructionView"];
export type InstructionProposalView = Schemas["InstructionProposalView"];
export type InstructionSource = Schemas["InstructionSource"];
export type UpdateInstructionRequest = Schemas["UpdateInstructionRequest"];
export type TemplateView = Schemas["TemplateView"];
export type ApplyTemplateResponse = Schemas["ApplyTemplateResponse"];

export type MemoryItem = Schemas["MemoryItem"];
export type MemoryListResponse = Schemas["MemoryListResponse"];
export type MemoryStatus = Schemas["MemoryStatus"];
export type MemoryType = Schemas["MemoryType"];
export type MemoryOrigin = Schemas["MemoryOrigin"];
export type MemoryCertainty = Schemas["MemoryCertainty"];
export type CreateMemoryRequest = Schemas["CreateMemoryRequest"];
export type PatchMemoryRequest = Schemas["PatchMemoryRequest"];
export type MemorySourcesResponse = Schemas["MemorySourcesResponse"];
export type MemorySourceView = Schemas["MemorySourceView"];
export type ParticipateInMemoryResponse = Schemas["ParticipateInMemoryResponse"];

export type ContextManifestView = Schemas["ContextManifestView"];
export type ResidentMemoryView = Schemas["ResidentMemoryView"];
export type SearchHitView = Schemas["SearchHitView"];
export type SearchRequest = Schemas["SearchRequest"];
export type SearchResponse = Schemas["SearchResponse"];
export type ContextOmissionView = Schemas["ContextOmissionView"];
