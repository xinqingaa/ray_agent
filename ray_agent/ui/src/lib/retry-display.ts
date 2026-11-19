import type {RunView, TimelineItem} from '@/lib/session-view'

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
export function retryEchoUserId(items: TimelineItem[], pending: NonNullable<RetryDisplay['pending']>) {
  return items.find(item => item.kind === 'user' && item.runId && item.runId !== pending.fromRunId
    && item.text === pending.text && !pending.knownUserIds.includes(item.id))?.id
}

/** 聊天只显示当前的自动重试状态，终态统一由结束条承接。原始事件仍可在日志查看。 */
export function conversationTimeline(items: TimelineItem[], runs: RunView[], retry: Pick<RetryDisplay, 'hiddenRunIds' | 'hiddenUserIds' | 'pending'>) {
  const echoId = retry.pending ? retryEchoUserId(items, retry.pending) : undefined
  const hiddenRuns = new Set(retry.hiddenRunIds)
  if (echoId && retry.pending) hiddenRuns.add(retry.pending.fromRunId)
  const terminalRuns = new Set(runs.filter(run => run.status !== 'running' && run.status !== 'waiting').map(run => run.id))
  const latestAttempt = new Map<string, Extract<TimelineItem, {kind: 'attempt'}>>()
  for (const item of items) {
    if (!item.runId) continue
    if (item.kind === 'run_end') terminalRuns.add(item.runId)
    if (item.kind === 'attempt') latestAttempt.set(item.runId, item)
  }
  const visibleAttempts = new Set<string>()
  for (const run of runs) {
    if (terminalRuns.has(run.id)) continue
    const attempt = latestAttempt.get(run.id)
    const turn = run.turns.at(-1)
    if (attempt?.retried && (!turn || (turn.index === attempt.turnIndex && turn.endedAt == null))) {
      visibleAttempts.add(attempt.id)
    }
  }
  const hiddenUsers = new Set(retry.hiddenUserIds)
  return {
    items: items.filter(item => {
      if (item.kind === 'user') return !hiddenUsers.has(item.id) && item.id !== echoId
      if (item.kind === 'run_end') return !item.runId || !hiddenRuns.has(item.runId)
      if (item.kind !== 'attempt') return true
      return visibleAttempts.has(item.id)
    }),
    runs: runs.filter(run => !hiddenRuns.has(run.id)),
  }
}
