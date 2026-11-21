/**
 * 桌面宿主提供的受限平台能力。组件只调用这里的方法，不直接判断平台或拼原生命令名。
 * 下载由宿主带令牌向核心请求并弹出保存对话框；外部链接与网页预览在系统浏览器中打开，不获得原生桥。
 */
import {invoke as tauriInvoke} from '@tauri-apps/api/core'
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

/** 宿主命令失败时 Tauri 拒绝的是字符串；统一成 Error，调用方才能读到原因。 */
export function hostError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  if (typeof reason === 'string' && reason) return new Error(reason)
  const message = (reason as {message?: unknown} | null)?.message
  return new Error(typeof message === 'string' && message ? message : '宿主操作失败')
}

async function invoke<T>(command: string, args?: Parameters<typeof tauriInvoke>[1], options?: Parameters<typeof tauriInvoke>[2]): Promise<T> {
  try {return await tauriInvoke<T>(command, args, options)}
  catch (reason) {throw hostError(reason)}
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

/** 选择文件夹的用途；对话框标题由宿主决定 */
export type FolderPurpose = 'open_workspace' | 'default_location' | 'relocate_workspace' | 'skill_extra_dir'

/** 一次性授权：宿主已用自己的密钥在核心登记所选文件夹，界面只拿到凭证与展示名，没有路径权限。 */
export type FolderGrant = {grant_id: string; name: string}

/** 弹出系统文件夹选择器；用户取消返回 null。 */
export function selectFolderGrant(purpose: FolderPurpose) {
  return invoke<FolderGrant | null>('select_folder_grant', {purpose})
}

/**
 * 在系统文件管理器中显示根内的文件或目录（空路径是根目录本身）。位置由宿主向核心解析，界面不接触绝对路径；
 * 目标不存在或不允许显示时抛出带原因的错误。浏览器开发模式没有这项能力，调用前用 `isDesktop()` 判断。
 */
export function revealInFileManager(rootId: string, relativePath: string) {
  return invoke<void>('reveal_in_file_manager', {rootId, relativePath})
}

/** 界面文案里的系统文件管理器名称 */
export function fileManagerName() {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent) ? 'Finder' : '文件管理器'
}

/** 桌面宿主不可用（浏览器开发模式等）时，设置相关调用抛出此错误，界面据此隐藏或说明。 */
export class HostUnavailableError extends Error {
  constructor(message = '这项设置只在 RayAgent 桌面应用中可用') {
    super(message)
    this.name = 'HostUnavailableError'
  }
}

function requireDesktop() {
  if (!isDesktop()) throw new HostUnavailableError()
}

/** 宿主自己保存的偏好（退出时也要读得到，因此不放在核心里）。 */
export type HostPreferences = {
  /** 任务完成、失败或等待回复时，用户不在该会话则发系统通知 */
  notifyOnFinish: boolean
  /** 有活动任务时退出前先原生确认 */
  confirmBeforeQuit: boolean
}

export type HostPreferencesPatch = Partial<HostPreferences>

/** 非桌面环境抛出 HostUnavailableError。 */
export function getHostPreferences() {
  requireDesktop()
  return invoke<HostPreferences>('host_preferences')
}

/** 只改传入的字段，返回保存后的完整偏好；非桌面环境抛出 HostUnavailableError。 */
export function setHostPreferences(patch: HostPreferencesPatch) {
  requireDesktop()
  return invoke<HostPreferences>('set_host_preferences', {patch})
}

/**
 * 系统通知授权状态。桌面端宿主读不到 macOS 的通知开关（插件恒报告已授权），返回 'unsupported'，
 * 设置页应提示用户到系统设置的通知中检查。非桌面环境同样返回 'unsupported'。
 */
export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationPermission(): Promise<NotificationPermission> {
  if (!isDesktop()) return Promise.resolve('unsupported')
  return invoke<NotificationPermission>('notification_permission')
}

/** 核心数据根的本机路径（与核心启动时使用的同一位置）；非桌面环境抛出 HostUnavailableError。 */
export function getDataLocation() {
  requireDesktop()
  return invoke<string>('data_location')
}

/** 在 Finder 中显示数据根；数据目录尚未创建时抛出带原因的错误。 */
export function revealDataLocation() {
  requireDesktop()
  return invoke<void>('reveal_data_location')
}

/** 界面当前停留的会话 ID（会话页），离开会话页传 null。宿主据此判断用户是否正在看这个会话。 */
export function setViewedSession(sessionId: string | null) {
  if (!isDesktop()) return Promise.resolve()
  return invoke<void>('set_viewed_session', {sessionId})
}

/** 用户点击任务完成通知时，宿主聚焦窗口并请界面打开该会话（载荷为会话 ID）。 */
export function onOpenSession(handler: (sessionId: string) => void) {
  return listen<string>('rayagent://open-session', event => handler(event.payload))
}
