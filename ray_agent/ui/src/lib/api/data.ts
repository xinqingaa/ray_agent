import {get, post} from './fetch'

export type CleanupTask = {
  id: string; scope: string; name: string
  state: 'running' | 'failed' | 'completed'; phase: string; completed: number; total: number
  error: string | null; counts: Record<string, number>; session_ids: string[]
}
export type CleanupPreview = {name: string; counts: Record<string, number>; blocked_reason: string | null; occupying_session_id: string | null; task: CleanupTask | null}
export const dataApi = {
  preview: () => get<CleanupPreview>('/data/preview'),
  latest: () => get<CleanupTask | null>('/data/tasks/latest'),
  read: (id: string) => get<CleanupTask>(`/data/tasks/${id}`),
  start: (confirmation: string) => post<CleanupTask>('/data/reset', {confirmation}),
  retry: (id: string) => post<CleanupTask>(`/data/tasks/${id}/retry`, {}),
}
