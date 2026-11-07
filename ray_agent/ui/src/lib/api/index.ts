/**
 * API 模块统一导出
 */

// 核心 fetch 封装
export {
  request,
  get,
  post,
  put,
  patch,
  del,
  createSSEStream,
  parseSSEStream,
  ApiError,
} from "./fetch";

// 类型定义
export type {
  ApiResponse,
  ErrorResponse,
  ErrorInfo,
  ErrorCode,
  CoreStatus,
  CapabilityStatus,
  BuildIdentity,
  SessionStatus,
  ExecutionStatus,
  ToolEventStatus,
  MCPTransport,
  LLMConfig,
  AgentConfig,
  ListMCPServerItem,
  MCPServerConfig,
  MCPConfig,
  MCPServersData,
  ListA2AServerItem,
  A2AServersData,
  CreateA2AServerParams,
  FileInfo,
  FileUploadParams,
  Session,
  SessionDetail,
  SessionsData,
  CreateSessionParams,
  ChatMessage,
  ChatParams,
  ChatAccepted,
  RunItem,
  RunStatus,
  TurnRequest,
  PlanStep,
  PlanEvent,
  StepEvent,
  ToolEvent,
  UsageEvent,
  SSEEventType,
  SSEEventData,
  SSEEventHandler,
  SessionFile,
  ViewFileParams,
  WorkspaceItem,
  WorkspaceStatus,
  FolderView,
  FolderStatus,
  OpenWorkspaceResult,
  MarkerConflict,
  ConflictResolution,
  ScanSummary,
  RootEntry,
  RootListing,
  OperationView,
  InstructionView,
  InstructionProposalView,
  TemplateView,
  MemoryItem,
  MemoryStatus,
  MemoryType,
  ContextManifestView,
} from "./types";

// 模块 API
export { configApi } from "./config";
export { fileApi } from "./file";
export { sessionApi } from "./session";
export { workspaceApi, operationApi, rootApi, historyApi } from "./workspace";
export { memoryApi } from "./memory";
export { instructionApi } from "./instruction";

