/* 由 ray_agent/contracts 从 core.schema.json 生成，勿手改；改 Pydantic 契约后运行 npm run generate。 */

/**
 * 核心启动参数、stdout 握手行与状态接口数据
 */
export type RayAgentCore = CoreLaunch | CoreHandshake | CoreStatus;
export type CoreHandshake = CoreReady | CoreFailed;
/**
 * 核心进程的一次启动
 */
export type InstanceId = string;
export type Capability =
  "file_access" | "local_command" | "browser" | "full_text_search" | "semantic_index" | "ocr" | "remote_control";
export type CapabilityState = "available" | "unavailable";
export type UnavailableReason =
  | "not_implemented"
  | "component_missing"
  | "component_failed"
  | "disabled"
  | "permission_denied"
  | "dependency_unavailable";
/**
 * 机器可读的错误代码，按客户端的处理方式区分；具体原因写在 message 与 details。
 */
export type ErrorCode =
  | "invalid_request"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "gone"
  | "payload_too_large"
  | "range_not_satisfiable"
  | "context_limit"
  | "rate_limited"
  | "internal_error"
  | "upstream_error"
  | "unavailable"
  | "timeout";
export type ResourceVersion = number | string;

/**
 * 宿主写入核心 stdin 的启动参数；凭据只经这条私有管道或环境文件传递，不进命令行。
 */
export interface CoreLaunch {
  /**
   * 可写数据目录
   */
  data_dir: string;
  /**
   * 依次叠加的环境文件，后者覆盖前者
   */
  env_files?: string[];
  /**
   * 最后叠加的显式环境
   */
  env?: {
    [k: string]: string;
  };
}
export interface CoreReady {
  /**
   * 核心协议版本
   */
  protocol_version: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  instance: CoreInstance;
  build: BuildIdentity;
  /**
   * 桌面业务库版本；尚未建立桌面业务库时为空
   */
  storage: StorageVersion | null;
  capabilities: CapabilityStatus[];
  event: "ready";
  port: number;
  /**
   * 实例令牌；尚未启用实例认证，目前为空
   */
  instance_token: string | null;
}
export interface CoreInstance {
  instance_id: InstanceId;
  pid: number;
  /**
   * 核心进程启动时间，毫秒时间戳
   */
  started_at: number;
}
/**
 * 构建身份；fingerprint 为空表示未知，不能用 Git 提交代替内容依据。
 */
export interface BuildIdentity {
  service: string;
  algorithm: string | null;
  fingerprint: string | null;
  revision: string | null;
  dirty: boolean | null;
  built_at: string | null;
}
export interface StorageVersion {
  /**
   * 业务库当前迁移版本
   */
  schema_revision: string;
}
export interface CapabilityStatus {
  capability: Capability;
  state: CapabilityState;
  reason: UnavailableReason | null;
  recoverable: boolean;
  detail: string | null;
}
export interface CoreFailed {
  event: "failed";
  /**
   * 核心协议版本
   */
  protocol_version: number;
  error: ErrorInfo;
}
/**
 * retryable 表示原样重试不会制造重复副作用；结果未知的失败为 false，需要先读回。
 */
export interface ErrorInfo {
  code: ErrorCode;
  /**
   * 给用户看的原因
   */
  message: string;
  retryable: boolean;
  /**
   * 建议的最短重试等待
   */
  retry_after_ms: number | null;
  /**
   * 冲突时资源的当前版本
   */
  resource_version: ResourceVersion | null;
  /**
   * 与代码相关的补充字段
   */
  details: {
    [k: string]: unknown;
  };
}
export interface CoreStatus {
  /**
   * 核心协议版本
   */
  protocol_version: number;
  /**
   * 事件结构版本
   */
  event_version: number;
  instance: CoreInstance;
  build: BuildIdentity;
  /**
   * 桌面业务库版本；尚未建立桌面业务库时为空
   */
  storage: StorageVersion | null;
  capabilities: CapabilityStatus[];
  /**
   * 全部依赖服务检查通过
   */
  healthy: boolean;
  services: HealthStatus[];
}
/**
 * 健康检查状态
 */
export interface HealthStatus {
  /**
   * 健康检查对应的服务名字
   */
  service: string;
  /**
   * ok 表示正常，error 表示出错
   */
  status: "ok" | "error";
  /**
   * 出错时的详情提示
   */
  details: string;
}
