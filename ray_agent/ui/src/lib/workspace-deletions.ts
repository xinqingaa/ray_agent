import type {OperationView} from '@/lib/api/types'

/**
 * 进行中的工作区删除。删除受理后工作区立即从列表消失，清理在后台继续；
 * 这里记下操作身份，使进度提示不依赖当前页面，刷新后也能读回。
 */
export type PendingDeletion = {operationId: string; workspaceId: string; name: string; sessionIds: string[]}

const KEY = 'rayagent:workspace-deletions'
const listeners = new Set<() => void>()
let cache: PendingDeletion[] | null = null

function load(): PendingDeletion[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    cache = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.operationId === 'string') : []
  } catch {cache = []}
  return cache!
}

function save(next: PendingDeletion[]) {
  cache = next
  try {localStorage.setItem(KEY, JSON.stringify(next))} catch {/* 仅内存保留 */}
  listeners.forEach(listener => listener())
}

export const pendingDeletions = () => load()
export function trackDeletion(item: PendingDeletion) {save([...load().filter(entry => entry.operationId !== item.operationId), item])}
export function forgetDeletion(operationId: string) {save(load().filter(entry => entry.operationId !== operationId))}
export function subscribeDeletions(listener: () => void) {
  listeners.add(listener)
  return () => {listeners.delete(listener)}
}

export type DeletionProgress = {state: 'running' | 'failed' | 'completed'; phase: string; completed: number; total: number | null; error: string | null; canRetry: boolean}

export function deletionProgress(operation: OperationView): DeletionProgress {
  const state = operation.status === 'succeeded' ? 'completed' : operation.status === 'queued' || operation.status === 'running' ? 'running' : 'failed'
  return {
    state, phase: operation.phase || (state === 'running' ? '等待清理' : ''),
    completed: operation.progress?.completed ?? 0, total: operation.progress?.total ?? null,
    error: operation.error?.message ?? (operation.status === 'cancelled' ? '清理已取消' : null),
    canRetry: operation.can_retry,
  }
}
