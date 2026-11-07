
import type {PlanAcceptance} from '@/lib/api/types'
import type {FileInfo, SessionDetail, SSEEventOf} from '@/lib/api/types'
import {normalizeEvents} from '@/lib/session-events'
import {readEventSeq} from '@/lib/session-projection'

export type Submission = {
  message: string
  attachments: string[]
  mode: 'normal' | 'plan'
  model?: string
  reasoning?: string
  execute_plan?: PlanAcceptance
  skill?: {id: string; version: string}; image_mode?: 'auto' | 'files'
  afterSeq: number
  state: 'sending' | 'unknown'
}
export type ChatDraft = {
  text: string
  files: FileInfo[]
  planMode: boolean
  skill?: {id: string; version: string; name?: string}
  imageMode?: 'auto' | 'files'
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
/** 草稿作用域：独立首页、工作区首页、具体会话各自一份，互不覆盖。 */
export const INDEPENDENT_SCOPE = 'independent'
export const workspaceDraftScope = (workspaceId: string) => `workspace:${workspaceId}`
export const sessionDraftScope = (sessionId: string) => `session:${sessionId}`

export type ClearedData = {id: string; scope: string; workspace_ids?: string[]; session_ids: string[]}
/** 清理完成后哪些草稿失效：全部清空，或所列工作区首页与会话的草稿。 */
export function draftClearedBy(data: ClearedData, scope: string): boolean {
  return data.scope === 'all' || (data.workspace_ids ?? []).some(id => scope === workspaceDraftScope(id)) || data.session_ids.some(id => scope === sessionDraftScope(id))
}
export function applyDataCleared(data: ClearedData): void {
  if (appliedCleanupIds.has(data.id)) return
  appliedCleanupIds.add(data.id)
  const scopes = new Set(volatileDrafts.keys())
  try {for (let index = 0; index < sessionStorage.length; index++) {const key = sessionStorage.key(index); if (key?.startsWith(prefix)) scopes.add(key.slice(prefix.length))}} catch {}
  for (const scope of scopes) if (draftClearedBy(data, scope)) clearDraft(scope)
  window.dispatchEvent(new CustomEvent(DATA_CLEARED, {detail: data}))
}
export function notifyDataCleared(data: ClearedData): void {
  if (appliedCleanupIds.has(data.id)) return
  applyDataCleared(data)
  try {
    if (data.scope === 'all') localStorage.setItem('rayagent:data-reset-at', String(Date.now()))
    const deleted = new Set<string>(JSON.parse(localStorage.getItem('rayagent:deleted-scopes') || '[]'))
    ;(data.workspace_ids ?? []).forEach(id => deleted.add(workspaceDraftScope(id))); data.session_ids.forEach(id => deleted.add(sessionDraftScope(id)))
    localStorage.setItem('rayagent:deleted-scopes', JSON.stringify([...deleted]))
    localStorage.setItem('rayagent:data-cleared', JSON.stringify(data))
  } catch {}
}

export type Acceptance = {kind: 'accepted'; runId: string; seq: number}
  | {kind: 'absent'} | {kind: 'ambiguous'}

/** 仅比较提交前序号之后的用户消息。重复文本/附件存在多条时不猜。 */
export function checkAcceptance(detail: SessionDetail, pending: Submission): Acceptance {
  if (pending.execute_plan) {
    const plan = normalizeEvents(detail.events).find(event => event.type === 'plan' &&
      event.data.accepted_from?.request_id === pending.execute_plan!.request_id)
    const runId = plan?.data.run_id
    if (!plan) return {kind: 'absent'}
    const message = normalizeEvents(detail.events).find(event => event.type === 'message' &&
      event.data.run_id === runId && event.data.role === 'user')
    return message && runId ? {kind: 'accepted', runId, seq: readEventSeq(message)!} : {kind: 'ambiguous'}
  }
  const matches = normalizeEvents(detail.events).filter((event): event is SSEEventOf<'message'> => {
    if (event.type !== 'message') return false
    const data = event.data
    if (data.role !== 'user' || data.message !== pending.message || (readEventSeq(event) ?? 0) <= pending.afterSeq
      || (data.image_mode ?? 'auto') !== (pending.image_mode ?? 'auto')) return false
    const selected = data.skill
    if ((selected?.id ?? null) !== (pending.skill?.id ?? null) || (selected?.version ?? null) !== (pending.skill?.version ?? null)) return false
    const ids = data.attachments.map((file) => file.id)
    return ids.length === pending.attachments.length && ids.every((id, index) => id === pending.attachments[index])
  })
  if (matches.length === 0) return {kind: 'absent'}
  if (matches.length !== 1) return {kind: 'ambiguous'}
  const runId = matches[0].data.run_id ?? null
  const seq = readEventSeq(matches[0])
  const run = detail.runs?.find(run => run.run_id === runId)
  const continuation = normalizeEvents(detail.events).some(event =>
    event.type === 'message' && event.data.run_id === runId && event.data.role === 'user'
      && (readEventSeq(event) ?? Infinity) <= pending.afterSeq)
  if (!runId || seq == null || !run || (continuation ? pending.mode !== 'normal' : run.mode !== pending.mode)) return {kind: 'ambiguous'}
  return {kind: 'accepted', runId, seq}
}
