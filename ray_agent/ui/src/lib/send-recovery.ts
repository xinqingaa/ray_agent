import {ApiError} from '@/lib/api/fetch'
import {sessionApi} from '@/lib/api/session'
import {checkAcceptance, readDraft, writeDraft, type Submission} from '@/lib/drafts'

export class UncertainSubmissionError extends Error {
  constructor(message = '发送结果尚未确认。请先核对历史，再决定是否重发。') { super(message) }
}

/** 读回受理记录，不自动重发。调用方成功后清理其作用域草稿。 */
export async function recoverSubmission(scope: string, sessionId: string): Promise<boolean> {
  const pending = readDraft(scope).submission
  if (!pending) return false
  if (pending.request_id) {
    try {
      await sessionApi.acceptedChat(sessionId, pending.request_id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        throw new UncertainSubmissionError('尚未找到这次发送的受理记录。请核对对话后确认是否重发。')
      throw new UncertainSubmissionError('暂时无法核对受理状态，请恢复连接后再次核对。')
    }
    writeDraft(scope, {submission: undefined})
    return true
  }
  let detail
  try { detail = await sessionApi.getSessionDetail(sessionId) }
  catch { throw new UncertainSubmissionError('暂时无法核对受理状态，请恢复连接后再次核对。') }
  const found = checkAcceptance(detail, pending)
  if (found.kind === 'accepted') {
    writeDraft(scope, {submission: undefined})
    return true
  }
  throw new UncertainSubmissionError(found.kind === 'ambiguous'
    ? '历史中有重复消息，无法确定这次受理结果。请核对对话后确认是否重发。'
    : '尚未发现这次消息的受理记录。请核对对话后确认是否重发。')
}

export async function sendRecoverably(scope: string, sessionId: string, payload: Omit<Submission, 'afterSeq' | 'state'>): Promise<void> {
  const previous = readDraft(scope).submission
  if (previous?.execute_plan) {
    const pending = previous.execute_plan
    const requested = payload.execute_plan
    const samePlan = requested?.source_run_id === pending.source_run_id &&
      requested.plan_id === pending.plan_id && requested.source_seq === pending.source_seq
    if (!samePlan) throw new UncertainSubmissionError('上一份计划的受理结果待核对，请先检查历史。')
    // 同一计划的再次确认沿用原标识，交给服务端幂等受理。
    await sessionApi.chat(sessionId, previous)
    writeDraft(scope, {submission: undefined})
    return
  }
  if (previous && await recoverSubmission(scope, sessionId)) return
  // 读取失败时不发出一条无法建立核对边界的消息。
  const before = await sessionApi.getSessionDetail(sessionId)
  const request = payload.knowledge_references?.length && !payload.request_id
    ? {...payload, request_id: crypto.randomUUID()} : payload
  const pending: Submission = {...request, afterSeq: before.last_seq ?? 0, state: 'sending'}
  writeDraft(scope, {submission: pending, sessionId})
  try {
    await sessionApi.chat(sessionId, request)
    writeDraft(scope, {submission: undefined})
  } catch (error) {
    if (error instanceof ApiError && error.rejected) {
      writeDraft(scope, {submission: undefined})
      throw error
    }
    writeDraft(scope, {submission: {...pending, state: 'unknown'}})
    if (await recoverSubmission(scope, sessionId)) return
  }
}

