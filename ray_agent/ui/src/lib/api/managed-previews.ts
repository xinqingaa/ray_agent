import type {components} from '@contracts/openapi'
import {saveResource} from '@/lib/platform'
import {del, get, post} from './fetch'

export type ManagedPreview = components['schemas']['ManagedPreviewView']
export type ManagedPreviewKind = ManagedPreview['kind']
export type ManagedPreviewState = ManagedPreview['state']
export type ManagedPreviewListResponse = components['schemas']['ManagedPreviewListResponse']
export type ManagedPreviewLogsResponse = components['schemas']['ManagedPreviewLogsResponse']
export type ManagedPreviewDeleteResponse = components['schemas']['ManagedPreviewDeleteResponse']

export const managedPreviewsApi = {
  list: async (filter?: {workspaceId?: string; sessionId?: string}): Promise<ManagedPreview[]> => {
    const query: Record<string, string> = {}
    if (filter?.workspaceId) query.workspace_id = filter.workspaceId
    if (filter?.sessionId) query.session_id = filter.sessionId
    const data = await get<ManagedPreviewListResponse>('/previews', Object.keys(query).length ? query : undefined)
    return data.previews ?? []
  },

  get: (previewId: string): Promise<ManagedPreview> => {
    return get<ManagedPreview>(`/previews/${encodeURIComponent(previewId)}`)
  },

  start: (previewId: string): Promise<ManagedPreview> => {
    return post<ManagedPreview>(`/previews/${encodeURIComponent(previewId)}/start`, {})
  },

  stop: (previewId: string): Promise<ManagedPreview> => {
    return post<ManagedPreview>(`/previews/${encodeURIComponent(previewId)}/stop`, {})
  },

  restart: (previewId: string): Promise<ManagedPreview> => {
    return post<ManagedPreview>(`/previews/${encodeURIComponent(previewId)}/restart`, {})
  },

  logs: (previewId: string, offset = 0): Promise<ManagedPreviewLogsResponse> => {
    return get<ManagedPreviewLogsResponse>(`/previews/${encodeURIComponent(previewId)}/logs`, {offset})
  },

  remove: (previewId: string): Promise<ManagedPreviewDeleteResponse> => {
    return del<ManagedPreviewDeleteResponse>(`/previews/${encodeURIComponent(previewId)}`)
  },

  exportZip: (preview: Pick<ManagedPreview, 'id' | 'name'>) => {
    const base = (preview.name || 'project').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project'
    const zipName = base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`
    return saveResource(`/previews/${encodeURIComponent(preview.id)}/export.zip`, zipName)
  },
}
