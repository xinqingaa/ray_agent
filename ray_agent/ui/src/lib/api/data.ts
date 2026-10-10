import {get, post} from './fetch'

export type CleanupTask = {
  id: string; scope: 'project' | 'all'; project_id: string | null; name: string
  state: 'running' | 'failed' | 'completed'; phase: string; completed: number; total: number
  error: string | null; counts: Record<string, number>; session_ids: string[]; project_ids: string[]
}
export type CleanupPreview = {name: string; counts: Record<string, number>; blocked_reason: string | null; occupying_session_id: string | null; task: CleanupTask | null}
export const dataApi = {
  preview: (projectId?: string) => get<CleanupPreview>('/data/preview', projectId ? {project_id: projectId} : {}),
  latest: (projectId?: string) => get<CleanupTask | null>('/data/tasks/latest', projectId ? {project_id: projectId} : {}),
  read: (id: string) => get<CleanupTask>(`/data/tasks/${id}`),
  start: (projectId: string | undefined, confirmation: string) => post<CleanupTask>(projectId ? `/data/projects/${projectId}/delete` : '/data/reset', {confirmation}),
  retry: (id: string) => post<CleanupTask>(`/data/tasks/${id}/retry`, {}),
}
