import type {components} from '@contracts/openapi'
import {get, post, put} from './fetch'
import type {KnowledgeReference, OperationView} from './types'

type Schemas = components['schemas']
export type IndexSummary = Schemas['IndexSummaryView']
export type DocumentItem = Schemas['DocumentView']
export type DocumentSource = Schemas['DocumentSourceView']
export type DocumentLocator = Schemas['DocumentLocator']
export type IndexPolicy = Schemas['IndexPolicyRequest']
export type DocumentCategory = Schemas['DocumentCategory']
export type AgentOutputPolicy = Schemas['AgentOutputPolicy']

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`

export const documentsApi = {
  summary: (workspaceId: string) =>
    get<IndexSummary>(`${workspacePath(workspaceId)}/documents/index`),

  list: (workspaceId: string) =>
    get<DocumentItem[]>(`${workspacePath(workspaceId)}/documents`),

  page: (workspaceId: string, after?: string, limit?: number) =>
    get<Schemas['DocumentPage']>(`${workspacePath(workspaceId)}/documents/page`, {...(after ? {after} : {}), ...(limit ? {limit} : {})}),

  sync: (workspaceId: string) =>
    post<OperationView>(`${workspacePath(workspaceId)}/documents/sync`, {}),

  policy: (workspaceId: string, policy: IndexPolicy) =>
    put<IndexSummary>(`${workspacePath(workspaceId)}/documents/policy`, policy),

  retry: (workspaceId: string, document?: DocumentItem) =>
    post<OperationView>(`${workspacePath(workspaceId)}/documents/retry`, document
      ? {document_id: document.id, revision: document.current_revision} : {}),

  retrySemantic: (workspaceId: string) =>
    post<OperationView | null>(`${workspacePath(workspaceId)}/documents/semantic/retry`, {}),

  source: (workspaceId: string, reference: KnowledgeReference, signal?: AbortSignal) =>
    get<DocumentSource>(`${workspacePath(workspaceId)}/documents/chunks/${encodeURIComponent(reference.source_id)}`,
      {version: reference.source_version}, {signal}),
}
