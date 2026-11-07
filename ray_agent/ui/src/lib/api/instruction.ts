import {get, post, put} from './fetch'
import type {
  ApplyTemplateResponse,
  InstructionProposalView,
  InstructionView,
  TemplateView,
  UpdateInstructionRequest,
  WorkspaceItem,
} from './types'

const instructionPath = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/instruction`

export const instructionApi = {
  get: (workspaceId: string) => get<InstructionView>(instructionPath(workspaceId)),

  put: (workspaceId: string, body: UpdateInstructionRequest) =>
    put<InstructionView>(instructionPath(workspaceId), body),

  proposals: (workspaceId: string, status?: string) =>
    get<{proposals: InstructionProposalView[]}>(
      `${instructionPath(workspaceId)}/proposals`,
      status ? {status} : undefined,
    ).then(data => data.proposals),

  acceptProposal: (workspaceId: string, proposalId: string) =>
    post<InstructionView>(`${instructionPath(workspaceId)}/proposals/${encodeURIComponent(proposalId)}/accept`, {}),

  rejectProposal: (workspaceId: string, proposalId: string) =>
    post<InstructionProposalView>(`${instructionPath(workspaceId)}/proposals/${encodeURIComponent(proposalId)}/reject`, {}),

  listTemplates: () => get<{templates: TemplateView[]}>('/templates').then(data => data.templates),

  saveTemplate: (workspaceId: string, name: string, includeToolSuggestions = false) =>
    post<TemplateView>('/templates', {workspace_id: workspaceId, name, include_tool_suggestions: includeToolSuggestions}),

  renameTemplate: (templateId: string, name: string) =>
    post<TemplateView>(`/templates/${encodeURIComponent(templateId)}/rename`, {name}),

  applyTemplate: (workspaceId: string, templateId: string, workspace: WorkspaceItem) =>
    post<ApplyTemplateResponse>(`/templates/${encodeURIComponent(templateId)}/apply`, {
      workspace_id: workspaceId,
      version: workspace.version,
    }),

  deleteTemplate: (templateId: string) =>
    post<Record<string, never>>(`/templates/${encodeURIComponent(templateId)}/delete`, {}),

  setAutoMemory: (workspace: WorkspaceItem, enabled: boolean) =>
    post<WorkspaceItem>(`/workspaces/${encodeURIComponent(workspace.id)}/auto-memory`, {
      enabled,
      version: workspace.version,
    }),
}
