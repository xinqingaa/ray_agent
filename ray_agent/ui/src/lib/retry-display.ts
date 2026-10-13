import type {TimelineItem} from '@/lib/session-view'

/** 仅记录用户点击重试产生的展示关联，不按相同文本合并普通发送。 */
export type RetryDisplay = {
  hiddenRunIds: string[]
  hiddenUserIds: string[]
  pending: {text: string; knownUserIds: string[]; fromRunId: string} | null
}
const empty = (): RetryDisplay => ({hiddenRunIds: [], hiddenUserIds: [], pending: null})
export function readRetryDisplay(sessionId: string): RetryDisplay {
  try {
    const value = JSON.parse(localStorage.getItem(`rayagent:retry-display:${sessionId}`) || 'null')
    if (!value || !Array.isArray(value.hiddenRunIds) || !Array.isArray(value.hiddenUserIds)
      || ![...value.hiddenRunIds, ...value.hiddenUserIds].every(id => typeof id === 'string')) return empty()
    const pending = value.pending
    if (pending && (typeof pending.text !== 'string' || typeof pending.fromRunId !== 'string'
      || !Array.isArray(pending.knownUserIds) || !pending.knownUserIds.every((id: unknown) => typeof id === 'string'))) return empty()
    const resetAt = Number(localStorage.getItem('rayagent:data-reset-at') || 0)
    const deleted = JSON.parse(localStorage.getItem('rayagent:deleted-scopes') || '[]')
    if (deleted.includes(`session:${sessionId}`) || (resetAt && (value.savedAt || 0) <= resetAt)) return empty()
    return {hiddenRunIds: value.hiddenRunIds, hiddenUserIds: value.hiddenUserIds, pending: pending ?? null}
  } catch {return empty()}
}
export function writeRetryDisplay(sessionId: string, value: RetryDisplay) {
  try {localStorage.setItem(`rayagent:retry-display:${sessionId}`, JSON.stringify({...value, savedAt: Date.now()}))} catch { /* 无法存储时仍支持当前页面重试。 */ }
}

/** 只关联点击之后第一条回显；后续用户主动重复发送仍正常显示。 */
export function retryEcho(items: TimelineItem[], pending: NonNullable<RetryDisplay['pending']>) {
  const user = items.find(item => item.kind === 'user' && item.runId !== pending.fromRunId
    && item.text === pending.text && !pending.knownUserIds.includes(item.id))
  return {
    userId: user?.id,
    settled: !!user?.runId && items.some(item => item.runId === user.runId && item.kind !== 'user' && item.kind !== 'protection'),
  }
}
