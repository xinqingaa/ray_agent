import {ApiError} from './fetch'

const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8088/api'

export type PreviewSource =
  | {kind: 'attachment'; id: string; filename: string; size?: number | null}
  | {kind: 'project'; id: string; path: string; filename: string; projectLevel: boolean; version?: string}

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

export function previewEndpoint(source: PreviewSource) {
  return source.kind === 'attachment' ? `/files/${encodeURIComponent(source.id)}/preview`
    : `${source.projectLevel ? '/projects' : '/sessions'}/${encodeURIComponent(source.id)}${source.projectLevel ? '' : '/project'}/preview`
}

export function previewParams(source: PreviewSource) {
  return source.kind === 'project' ? new URLSearchParams({path: source.path}) : new URLSearchParams()
}

export function previewContentUrl(source: PreviewSource, revision?: string) {
  const params = previewParams(source)
  if (revision) params.set('revision', revision)
  return base + previewEndpoint(source) + '/content?' + params
}

/** 网页文件单击即在新标签页渲染；服务端用 CSP sandbox 隔离，页面读不到本站接口与存储 */
export function isWebPage(filename: string) {
  return /\.html?$/i.test(filename)
}

export function openPreviewTab(source: PreviewSource) {
  const link = document.createElement('a')
  link.href = previewContentUrl(source); link.target = '_blank'; link.rel = 'noopener noreferrer'
  document.body.appendChild(link); link.click(); link.remove()
}

export async function readPreview(endpoint: string, params: URLSearchParams, signal: AbortSignal): Promise<FilePreview> {
  const response = await fetch(`${base}${endpoint}?${params}`, {signal, cache: 'no-store'})
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.data) throw new ApiError(response.status, body?.msg || '读取失败')
  return body.data
}

export async function downloadPreviewSource(source: PreviewSource) {
  const url = source.kind === 'attachment' ? `${base}/files/${encodeURIComponent(source.id)}/download`
    : `${base}/projects/${encodeURIComponent(source.id)}/download?path=${encodeURIComponent(source.path)}`
  if (source.kind === 'project' && !source.projectLevel) throw new Error('无法确定项目下载入口')
  const response = await fetch(url, {method:'HEAD'})
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.msg || '下载失败')
  }
  startDownload(url, source.filename)
}

export function startDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove()
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFileBatch(files: {id: string}[]) {
  const params=new URLSearchParams()
  files.forEach(file=>params.append('file_id',file.id))
  const url=`${base}/files/download-batch?${params}`
  const response = await fetch(url, {method:'HEAD'})
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.msg || '打包失败')
  }
  startDownload(url, '会话文件.zip')
}
