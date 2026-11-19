import {get, patch as patchRequest, post, request} from './fetch'
import type {
  ContextManifestView,
  CreateMemoryRequest,
  MemoryExtractionView,
  MemoryItem,
  MemoryListResponse,
  MemorySourcesResponse,
  MemoryStatus,
  KnowledgeReference,
  SearchHitView,
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

  search: (workspaceId: string, body: Omit<SearchRequest, 'limit'> & {limit?: number}, signal?: AbortSignal) =>
    post<SearchResponse>(`${workspacePath(workspaceId)}/search`, body, {signal}),

  source: (workspaceId: string, ref: KnowledgeReference, signal?: AbortSignal) =>
    get<SearchHitView>(`${workspacePath(workspaceId)}/search/sources/${ref.source_type}/${encodeURIComponent(ref.source_id)}`,
      {source_version: ref.source_version}, {signal}),

  extraction: (workspaceId: string, sessionId: string, sequence: number) =>
    get<MemoryExtractionView>(memoriesPath(workspaceId, '/extraction'), {session_id: sessionId, seq: sequence}),

  contextManifest: (runId: string) =>
    get<ContextManifestView>(`/runs/${encodeURIComponent(runId)}/context-manifest`),

  participate: (sessionId: string, participate: boolean) =>
    post<ParticipateInMemoryResponse>(`/sessions/${encodeURIComponent(sessionId)}/participate-in-memory`, {participate}),
}
