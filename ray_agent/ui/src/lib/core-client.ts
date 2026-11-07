/**
 * 核心连接：接口地址与实例令牌只在这里保存，所有请求、SSE、上传与下载经它拼地址和请求头。
 * 令牌只放在 Authorization 头里，不进 URL；按 URL 加载的预览资源使用短期票据。
 */
export type CoreConnection = {baseUrl: string; token: string}

let connection: CoreConnection | null = null

export function setCoreConnection(next: CoreConnection | null) {
  connection = next
}

export function coreConnected() {
  return connection !== null
}

/** endpoint 为 /api 之后的路径，如 `/sessions`；完整地址原样返回 */
export function coreUrl(endpoint: string) {
  if (/^https?:\/\//.test(endpoint)) return endpoint
  return `${connection?.baseUrl ?? ''}${endpoint}`
}

export function coreHeaders(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers)
  if (connection) merged.set('Authorization', `Bearer ${connection.token}`)
  return merged
}
