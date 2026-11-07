import {get, patch as patchRequest, post, request} from './fetch'
import type {
  ContextManifestView,
  CreateMemoryRequest,
  MemoryItem,
  MemoryListResponse,
  MemorySourcesResponse,
  MemoryStatus,
  ParticipateInMemoryResponse,
  PatchMemoryRequest,
  SearchRequest,
  SearchResponse,
} from './types'

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`

function memoriesPath(workspaceId: string, suffix = '') {
  return `${workspacePath(workspaceId)}/memories${suffix}`
}

function listQuery(status?: MemoryStatus[]) {
  if (!status?.length) return ''
  const params = new URLSearchParams()
  for (const item of status) params.append('status', item)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const memoryApi = {
  list: (workspaceId: string, status?: MemoryStatus[]) =>
    request<MemoryListResponse>(`${memoriesPath(workspaceId)}${listQuery(status)}`),

  create: (workspaceId: string, body: CreateMemoryRequest) =>
    post<MemoryItem>(memoriesPath(workspaceId), body),

  patch: (workspaceId: string, memoryId: string, body: PatchMemoryRequest) =>
    patchRequest<MemoryItem>(`${memoriesPath(workspaceId)}/${encodeURIComponent(memoryId)}`, body),

  sources: (workspaceId: string, memoryId: string) =>
    get<MemorySourcesResponse>(`${memoriesPath(workspaceId)}/${encodeURIComponent(memoryId)}/sources`),

  search: (workspaceId: string, body: SearchRequest) =>
    post<SearchResponse>(`${workspacePath(workspaceId)}/search`, body),

  contextManifest: (runId: string) =>
    get<ContextManifestView>(`/runs/${encodeURIComponent(runId)}/context-manifest`),

  participate: (sessionId: string, participate: boolean) =>
    post<ParticipateInMemoryResponse>(`/sessions/${encodeURIComponent(sessionId)}/participate-in-memory`, {participate}),
}
