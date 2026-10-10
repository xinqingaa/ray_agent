import type {FileInfo, SessionDetail} from '@/lib/api/types'
import {normalizeEvents} from '@/lib/session-events'
import {readEventSeq} from '@/lib/session-projection'

export type Submission = {
  message: string
  attachments: string[]
  mode: 'normal' | 'plan'
  model?: string
  reasoning?: string
  afterSeq: number
  state: 'sending' | 'unknown'
}
export type ChatDraft = {
  text: string
  files: FileInfo[]
  planMode: boolean
  creationId?: string
  sessionId?: string
  submission?: Submission
  savedAt?: number
  compactionAfterSeq?: number
}
export const EMPTY_DRAFT: ChatDraft = {text: '', files: [], planMode: false}
const volatileDrafts=new Map<string,ChatDraft>()
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
    const resetAt = Number(localStorage.getItem('rayagent:data-reset-at') || 0)
    const deleted = JSON.parse(localStorage.getItem('rayagent:deleted-scopes') || '[]') as string[]
    if (deleted.includes(scope) || (resetAt && (parsed?.savedAt || 0) <= resetAt)) return {...EMPTY_DRAFT}
    return parsed && typeof parsed.text === 'string' && Array.isArray(parsed.files)
      ? parsed : volatileDrafts.get(scope) ?? {...EMPTY_DRAFT}
  } catch { return volatileDrafts.get(scope) ?? {...EMPTY_DRAFT} }
}
export function writeDraft(scope: string, changes: Partial<ChatDraft>): void {
  const next={...readDraft(scope),...changes,savedAt:Date.now()}
  volatileDrafts.set(scope,next)
  try{sessionStorage.setItem(prefix + scope, JSON.stringify(next))}catch{/* 当前标签内存仍保留草稿 */}
  changed(scope)
}
export function clearDraft(scope: string): void {
  volatileDrafts.delete(scope)
  try{sessionStorage.removeItem(prefix + scope)}catch{}
  changed(scope)
}

export const DATA_CLEARED = 'rayagent-data-cleared'
const appliedCleanupIds = new Set<string>()
type ClearedData = {id: string; scope: string; project_ids: string[]; session_ids: string[]}
export function applyDataCleared(data: ClearedData): void {
  if (appliedCleanupIds.has(data.id)) return
  appliedCleanupIds.add(data.id)
  const affected = (scope: string) => data.scope === 'all' || data.project_ids.some(id => scope === `project:${id}`) || data.session_ids.some(id => scope === `session:${id}`)
  const scopes = new Set(volatileDrafts.keys())
  try {for (let index = 0; index < sessionStorage.length; index++) {const key = sessionStorage.key(index); if (key?.startsWith(prefix)) scopes.add(key.slice(prefix.length))}} catch {}
  for (const scope of scopes) if (affected(scope)) clearDraft(scope)
  window.dispatchEvent(new CustomEvent(DATA_CLEARED, {detail: data}))
}
export function notifyDataCleared(data: ClearedData): void {
  if (appliedCleanupIds.has(data.id)) return
  applyDataCleared(data)
  try {
    if (data.scope === 'all') localStorage.setItem('rayagent:data-reset-at', String(Date.now()))
    const deleted = new Set<string>(JSON.parse(localStorage.getItem('rayagent:deleted-scopes') || '[]'))
    data.project_ids.forEach(id => deleted.add(`project:${id}`)); data.session_ids.forEach(id => deleted.add(`session:${id}`))
    localStorage.setItem('rayagent:deleted-scopes', JSON.stringify([...deleted]))
    localStorage.setItem('rayagent:data-cleared', JSON.stringify(data))
  } catch {}
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
  const run = detail.runs?.find(run => run.run_id === runId)
  const continuation = normalizeEvents(detail.events).some(event => {
    if (event.type !== 'message' || !event.data || typeof event.data !== 'object') return false
    const data = event.data as Record<string, unknown>
    return data.run_id === runId && data.role === 'user' && (readEventSeq(event) ?? Infinity) <= pending.afterSeq
  })
  if (!runId || seq == null || !run || (continuation ? pending.mode !== 'normal' : run.mode !== pending.mode)) return {kind: 'ambiguous'}
  return {kind: 'accepted', runId, seq}
}
