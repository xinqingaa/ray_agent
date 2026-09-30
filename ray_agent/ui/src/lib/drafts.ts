import type {FileInfo, SessionDetail} from '@/lib/api/types'
import {normalizeEvents} from '@/lib/session-events'
import {readEventSeq} from '@/lib/session-projection'

export type Submission = {
  message: string
  attachments: string[]
  mode: 'normal' | 'plan'
  afterSeq: number
  state: 'sending' | 'unknown'
}
export type ChatDraft = {
  text: string
  files: FileInfo[]
  planMode: boolean
  sessionId?: string
  submission?: Submission
  compactionAfterSeq?: number
}
export const EMPTY_DRAFT: ChatDraft = {text: '', files: [], planMode: false}
const prefix = 'rayagent:draft:'
export const DRAFT_CHANGED = 'rayagent-draft-changed'
function changed(scope: string): void {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent?.(new CustomEvent(DRAFT_CHANGED, {detail: scope}))
}

/** 本标签临时草稿，不将用户文字放进 URL。 */
export function readDraft(scope: string): ChatDraft {
  if (typeof window === 'undefined') return {...EMPTY_DRAFT}
  try {
    const parsed = JSON.parse(sessionStorage.getItem(prefix + scope) ?? 'null')
    return parsed && typeof parsed.text === 'string' && Array.isArray(parsed.files)
      ? parsed : {...EMPTY_DRAFT}
  } catch { return {...EMPTY_DRAFT} }
}
export function writeDraft(scope: string, changes: Partial<ChatDraft>): void {
  sessionStorage.setItem(prefix + scope, JSON.stringify({...readDraft(scope), ...changes}))
  changed(scope)
}
export function clearDraft(scope: string): void {
  sessionStorage.removeItem(prefix + scope)
  changed(scope)
}

export type Acceptance = {kind: 'accepted'; runId: string; seq: number}
  | {kind: 'absent'} | {kind: 'ambiguous'}

/** 仅比较提交前序号之后的用户消息。重复文本/附件存在多条时不猜。 */
export function checkAcceptance(detail: SessionDetail, pending: Submission): Acceptance {
  const matches = normalizeEvents(detail.events).filter((event) => {
    if (event.type !== 'message' || !event.data || typeof event.data !== 'object') return false
    const data = event.data as Record<string, unknown>
    if (data.role !== 'user' || data.message !== pending.message || (readEventSeq(event) ?? 0) <= pending.afterSeq) return false
    const ids = Array.isArray(data.attachments)
      ? data.attachments.map((file) => typeof file === 'object' && file ? (file as {id?: string}).id : null) : []
    return ids.length === pending.attachments.length && ids.every((id, index) => id === pending.attachments[index])
  })
  if (matches.length === 0) return {kind: 'absent'}
  if (matches.length !== 1) return {kind: 'ambiguous'}
  const data = matches[0].data as Record<string, unknown>
  const runId = typeof data.run_id === 'string' ? data.run_id : null
  const seq = readEventSeq(matches[0])
  if (!runId || seq == null || !detail.runs?.some((run) => run.run_id === runId)) return {kind: 'ambiguous'}
  return {kind: 'accepted', runId, seq}
}
