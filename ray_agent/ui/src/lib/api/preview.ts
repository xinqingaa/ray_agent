import {coreHeaders, coreUrl} from '@/lib/core-client'
import {openExternal, saveBytes, saveResource} from '@/lib/platform'
import {clientError, errorFromBody, post} from './fetch'
import type {components} from '@contracts/openapi'

type ResourceTicket = components['schemas']['ResourceTicket']

/** 预览对象：附件与交付版本按文件 ID，工作区文件夹里的文件按 root_id 加相对路径。 */
export type AttachmentSource = {kind: 'attachment'; id: string; filename: string; size?: number | null}
export type RootSource = {kind: 'root'; rootId: string; path: string; filename: string; size?: number | null}
export type PreviewSource = AttachmentSource | RootSource

export type PreviewCell = {
  text: string; formula?: string | null; uncached?: boolean
  style?: {bold: boolean; italic: boolean; color?: string | null; background?: string | null; align?: 'left' | 'right' | 'center' | null; wrap: boolean; borders: boolean[]} | null
}
export type FilePreview = {
  kind: 'text' | 'markdown' | 'table' | 'image' | 'pdf' | 'unavailable'
  filename: string; revision: string; size: number; reason?: string; partial?: boolean
  content?: string; offset?: number; next_offset?: number | null
  thumbnail?: string; width?: number; height?: number
  sheets?: string[]; sheet?: number; row?: number; column?: number; rows?: PreviewCell[][]; widths?: number[]
  merges?: {row: number; column: number; rows: number; columns: number}[]
  total_rows?: number | null; total_columns?: number | null
  next_row?: number | null; next_column?: number | null; formula_missing?: boolean; cells_truncated?: boolean; input_limited?: boolean
}

/** 预览接口地址；根内文件的路径放在查询串里，所以它同时是该对象的稳定标识。 */
export function previewEndpoint(source: PreviewSource) {
  if (source.kind === 'root') return `/roots/${encodeURIComponent(source.rootId)}/preview?${new URLSearchParams({path: source.path})}`
  return `/files/${encodeURIComponent(source.id)}/preview`
}

/** 根内路径逐段编码后放进 URL 路径；票据按这条路径签发。 */
export function rootContentPath(rootId: string, path: string) {
  return `/roots/${encodeURIComponent(rootId)}/preview/content/${path.split('/').map(encodeURIComponent).join('/')}`
}

function appendQuery(url: string, query: string) {
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

/** 剩余有效期不足时换新票据，避免页面加载途中失效 */
const TICKET_REFRESH_MS = 60_000
const tickets = new Map<string, Promise<ResourceTicket>>()

async function ticketFor(key: string, endpoint: string): Promise<string> {
  const cached = await tickets.get(key)?.catch(() => null)
  if (cached && cached.expires_at - Date.now() > TICKET_REFRESH_MS) return cached.ticket
  const pending = post<ResourceTicket>(endpoint)
  tickets.set(key, pending)
  try {return (await pending).ticket}
  catch (error) {tickets.delete(key); throw error}
}

/** 图片、PDF 与网页按 URL 加载，带只读本文件内容的短期票据 */
export async function previewContentUrl(source: PreviewSource, revision?: string) {
  const root = source.kind === 'root'
  const ticket = await ticketFor(
    root ? `root:${source.rootId}:${source.path}` : source.id,
    root ? `/roots/${encodeURIComponent(source.rootId)}/preview/ticket?${new URLSearchParams({path: source.path})}`
      : `/files/${encodeURIComponent(source.id)}/preview/ticket`)
  const params = new URLSearchParams({ticket})
  if (revision) params.set('revision', revision)
  return coreUrl(`${root ? rootContentPath(source.rootId, source.path) : `/files/${encodeURIComponent(source.id)}/preview/content`}?${params}`)
}

/** 网页文件在系统浏览器中渲染；服务端用 CSP sandbox 隔离，页面读不到核心接口与原生能力 */
export function isWebPage(filename: string) {
  return /\.html?$/i.test(filename)
}

export async function openPreviewTab(source: PreviewSource) {
  await openExternal(await previewContentUrl(source))
}

export async function readPreview(endpoint: string, params: URLSearchParams, signal: AbortSignal): Promise<FilePreview> {
  const query = params.toString()
  const response = await fetch(coreUrl(appendQuery(endpoint, query)), {signal, cache: 'no-store', headers: coreHeaders()})
  const body = await response.json().catch(() => null)
  if (!response.ok) throw errorFromBody(response.status, body, '读取失败')
  if (!body?.data) throw clientError('unavailable', '读取失败')
  return body.data
}

export function downloadFile(fileId: string, filename: string) {
  return saveResource(`/files/${encodeURIComponent(fileId)}/download`, filename)
}

/** 附件与交付版本可以下载；工作区文件夹里的文件是用户自己的文件，界面不提供副本下载。 */
export function canDownload(source: PreviewSource): source is AttachmentSource {
  return source.kind === 'attachment'
}

export function downloadPreviewSource(source: PreviewSource) {
  if (!canDownload(source)) return Promise.reject(new Error('文件夹中的文件不提供下载，请在文件夹中直接使用'))
  return downloadFile(source.id, source.filename)
}

export function saveDownload(blob: Blob, filename: string) {
  return saveBytes(blob, filename)
}

/** 内联图片直接保存字节；远程图片交给系统浏览器 */
export async function saveImage(src: string, filename: string) {
  const inline = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src)
  if (!inline) return openExternal(src)
  const text = inline[2] ? atob(inline[3]) : decodeURIComponent(inline[3])
  const bytes = Uint8Array.from(text, char => char.charCodeAt(0))
  await saveBytes(new Blob([bytes], {type: inline[1] || 'application/octet-stream'}), filename)
}

export async function downloadFileBatch(files: {id: string}[]) {
  const params = new URLSearchParams()
  files.forEach(file => params.append('file_id', file.id))
  await saveResource(`/files/download-batch?${params}`, '会话文件.zip')
}
