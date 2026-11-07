/**
 * 桌面宿主提供的受限平台能力。组件只调用这里的方法，不直接判断平台或拼原生命令名。
 * 下载由宿主带令牌向核心请求并弹出保存对话框；外部链接与网页预览在系统浏览器中打开，不获得原生桥。
 */
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import type {ErrorInfo} from '@/lib/api/types'

export type CoreState = 'starting' | 'ready' | 'failed' | 'incompatible' | 'exited' | 'stopped'

export type HostConnection = {
  state: CoreState
  startup_ms: number | null
  base_url: string | null
  token: string | null
  error: ErrorInfo | null
  detail: string | null
  logs: string[]
}

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function readCoreConnection() {
  return invoke<HostConnection>('core_connection')
}

export function restartCore() {
  return invoke<void>('restart_core')
}

/** endpoint 为 /api 之后的 GET 资源路径。用户取消时返回 null。 */
export function saveResource(endpoint: string, filename: string) {
  return invoke<string | null>('save_resource', {path: `/api${endpoint}`, filename})
}

export async function saveBytes(blob: Blob, filename: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return invoke<string | null>('save_bytes', bytes, {headers: {'x-filename': encodeURIComponent(filename)}})
}

export function openExternal(url: string) {
  return invoke<void>('open_external', {url})
}

/** 文件不存在时由宿主按示例创建，返回实际路径 */
export function openModelConfig() {
  return invoke<string>('open_model_config')
}

/** 用户退出时宿主先询问界面；界面须立即确认收到，再决定是否退出。 */
export function onQuitRequested(handler: () => void) {
  return listen('rayagent://quit-requested', () => {
    void invoke('quit_ack')
    handler()
  })
}

export function confirmQuit() {
  return invoke<void>('quit_confirm')
}
