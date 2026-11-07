import {get, post} from './fetch'

export type IndexSummary = {
  workspace_id: string
  total: number
  searchable: number
  pending: number
  parsing: number
  pending_component: number
  failed: number
  withdrawn: number
  truncated_scan: boolean
  active_operation_id?: string | null
  publication_generation: number
}

export type DocumentItem = {
  id: string
  relative_path: string
  current_revision: number
  status: string
  format: string
  updated_at: number
}

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`

export const documentsApi = {
  summary: (workspaceId: string) =>
    get<IndexSummary>(`${workspacePath(workspaceId)}/documents/index`),

  list: (workspaceId: string) =>
    get<DocumentItem[]>(`${workspacePath(workspaceId)}/documents`),

  sync: (workspaceId: string, paths?: string[]) =>
    post<Record<string, unknown>>(`${workspacePath(workspaceId)}/documents/sync`, {paths: paths ?? null}),
}
