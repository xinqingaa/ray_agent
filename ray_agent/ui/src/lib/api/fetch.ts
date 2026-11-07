import { coreHeaders, coreUrl } from "@/lib/core-client";
import type { ApiResponse, ErrorCode, ErrorInfo, ErrorResponse } from "./types";

const API_CONFIG = {
  timeout: 30000, // 30秒
} as const;

/**
 * 接口失败：status 为 HTTP 状态，没有收到响应时为 0；其余字段来自核心返回的结构化错误。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly resourceVersion: number | string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, info: ErrorInfo) {
    super(info.message);
    this.name = "ApiError";
    this.status = status;
    this.code = info.code;
    this.retryable = info.retryable;
    this.retryAfterMs = info.retry_after_ms;
    this.resourceVersion = info.resource_version;
    this.details = info.details;
  }

  /** 核心已处理并明确拒绝；没有响应、超时与 5xx 的结果未知，需要先读回 */
  get rejected(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** 没有收到核心响应时的失败；结果未知，不能直接视为未执行 */
export function clientError(code: "timeout" | "unavailable", message: string): ApiError {
  return new ApiError(0, {code, message, retryable: false, retry_after_ms: null, resource_version: null, details: {}});
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  const error = (body as ErrorResponse | null)?.error;
  return !!error && typeof error.code === "string" && typeof error.message === "string";
}

/** 按失败响应体构造错误；不是结构化错误（如网关返回的页面）时按状态给出通用原因 */
export function errorFromBody(status: number, body: unknown, fallback?: string): ApiError {
  if (isErrorResponse(body)) return new ApiError(status, body.error);
  return new ApiError(status, {
    code: status >= 500 ? "unavailable" : "invalid_request",
    message: fallback || (status >= 500 ? "服务暂时不可用，请核对最新状态后重试" : "请求失败，请重试"),
    retryable: false,
    retry_after_ms: null,
    resource_version: null,
    details: {},
  });
}

/**
 * 请求选项
 */
type RequestOptions = RequestInit & {
  timeout?: number;
};

/**
 * 解析成功响应
 */
async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return ((await response.json()) as ApiResponse<T>).data;
  }

  // 处理非 JSON 响应（如文件下载）
  return (await response.text()) as unknown as T;
}

/**
 * 处理错误响应
 */
export async function handleErrorResponse(response: Response, fallback?: string): Promise<never> {
  const body = await response.json().catch(() => null);
  throw errorFromBody(response.status, body, fallback);
}

/**
 * 带超时的 fetch
 */
function fetchWithTimeout(
  url: string,
  options: RequestOptions = {},
  timeout: number = API_CONFIG.timeout
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(clientError("timeout", "请求超时"));
    }, timeout);

    fetch(coreUrl(url), {
      ...options,
      headers: coreHeaders(options.headers),
      signal: controller.signal,
    })
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
          reject(clientError("timeout", "请求超时"));
        } else {
          reject(error);
        }
      });
  });
}

/**
 * 核心请求函数
 */
export async function request<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = endpoint;

  const {
    timeout = API_CONFIG.timeout,
    headers = {},
    ...fetchOptions
  } = options;

  // 合并请求头
  const mergedHeaders: HeadersInit = {
    ...(fetchOptions.body != null && !(fetchOptions.body instanceof FormData) ? {"Content-Type": "application/json"} : {}),
    ...headers,
  };

  // 如果是 FormData，删除 Content-Type 让浏览器自动设置
  if (fetchOptions.body instanceof FormData) {
    delete (mergedHeaders as Record<string, string>)["Content-Type"];
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        ...fetchOptions,
        headers: mergedHeaders,
      },
      timeout
    );

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    return await parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    // 处理网络错误
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw clientError("unavailable", "网络连接失败，请检查网络设置");
    }

    throw clientError("unavailable", error instanceof Error ? error.message : "未知错误");
  }
}

/**
 * GET 请求
 */
export function get<T = unknown>(
  endpoint: string,
  params?: Record<string, string | number | boolean>,
  options?: RequestOptions
): Promise<T> {
  let url = endpoint;
  
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  return request<T>(url, {
    ...options,
    method: "GET",
  });
}

/**
 * POST 请求
 */
export function post<T = unknown>(
  endpoint: string,
  data?: unknown,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "POST",
    body: data instanceof FormData ? data : JSON.stringify(data),
  });
}

/**
 * PUT 请求
 */
export function put<T = unknown>(
  endpoint: string,
  data?: unknown,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * DELETE 请求
 */
export function del<T = unknown>(
  endpoint: string,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "DELETE",
  });
}

/**
 * 创建流式 SSE 连接（默认 POST；`method: "GET"` 时不发送请求体）
 *
 * @param endpoint  接口路径
 * @param data      请求体
 * @param options   请求选项，可通过 `signal` 传入外部 AbortSignal 以便调用方随时中止连接
 */
export async function createSSEStream(
  endpoint: string,
  data?: unknown,
  options?: RequestOptions
): Promise<ReadableStream<Uint8Array>> {
  const url = coreUrl(endpoint);

  const {
    timeout = API_CONFIG.timeout,
    headers = {},
    signal: externalSignal,
    method = "POST",
    ...fetchOptions
  } = options || {};
  const hasBody = method !== "GET";

  const mergedHeaders: HeadersInit = {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    Accept: "text/event-stream",
    ...headers,
  };

  const controller = new AbortController();
  // 只对初始连接设置超时，连接建立后会清除
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  // 将外部 AbortSignal 关联到内部 controller，
  // 这样调用方 abort 时会同时中止底层 fetch 连接
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      externalSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          controller.abort();
        },
        { once: true },
      );
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers: coreHeaders(mergedHeaders),
      body: hasBody ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });

    // 连接已建立，清除初始连接的超时
    clearTimeout(timeoutId);

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    if (!response.body) {
      throw clientError("unavailable", "响应体为空");
    }

    return response.body;
  } catch (error) {
    clearTimeout(timeoutId);
    // 忽略 AbortError，这是正常的连接中止
    if (error instanceof Error && error.name === 'AbortError') {
      throw error; // 重新抛出，让调用方处理
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw clientError("unavailable", error instanceof Error ? error.message : "未知错误");
  }
}

/**
 * 解析 SSE 事件流
 */
export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: MessageEvent) => void,
  onError?: (error: Error) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // 处理缓冲区中剩余的数据
        if (buffer.trim()) {
          processSSEBuffer(buffer, onEvent, onError);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // 标准化行尾：服务端可能使用 \r\n (CRLF)，统一转为 \n (LF)
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      const parts = buffer.split("\n\n");
      
      // 保留最后一个不完整的事件（可能没有以 \n\n 结尾）
      buffer = parts.pop() || "";

      // 处理完整的事件
      for (const part of parts) {
        if (part.trim()) {
          processSSEEvent(part, onEvent, onError);
        }
      }
    }
  } catch (error) {
    // 忽略 AbortError，这是正常的连接中止
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    if (onError) {
      onError(error instanceof Error ? error : new Error("读取流失败"));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 忽略 releaseLock 错误，可能已经被释放
    }
  }
}

/**
 * 处理单个 SSE 事件
 */
function processSSEEvent(
  eventText: string,
  onEvent: (event: MessageEvent) => void,
  onError?: (error: Error) => void
): void {
  let eventType = "message";
  let eventData = "";
  let eventId = "";

  const lines = eventText.split("\n");
  
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // 支持多行数据
      const dataLine = line.slice(5);
      if (eventData) {
        eventData += "\n" + dataLine;
      } else {
        eventData = dataLine;
      }
    } else if (line.startsWith("id:")) {
      eventId = line.slice(3).trim();
    }
    // 忽略其他行（如 retry:、comment 等）
  }

  if (eventData) {
    try {
      const data = JSON.parse(eventData.trim());
      onEvent(
        new MessageEvent(eventType, {
          data,
          lastEventId: eventId,
        })
      );
    } catch (error) {
      if (onError) {
        onError(
          error instanceof Error
            ? error
            : new Error(`解析 SSE 数据失败: ${eventData}`)
        );
      }
    }
  }
}

/**
 * 处理 SSE 缓冲区（用于处理流结束时的剩余数据）
 */
function processSSEBuffer(
  buffer: string,
  onEvent: (event: MessageEvent) => void,
  onError?: (error: Error) => void
): void {
  const events = buffer.split("\n\n").filter((e) => e.trim());
  for (const event of events) {
    processSSEEvent(event, onEvent, onError);
  }
}


/** 包资源保留原始字节，复用 API 错误与超时处理。 */
export async function requestBlob(endpoint: string): Promise<Blob> {
  try {
    const response = await fetchWithTimeout(endpoint)
    if (!response.ok) await handleErrorResponse(response)
    return await response.blob()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw clientError('unavailable', '文件读取连接中断，请重试')
  }
}
