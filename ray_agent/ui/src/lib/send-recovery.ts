import {projectApi} from '@/lib/api/project'
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
  if (readDraft(scope).submission) {
    if (await recoverSubmission(scope, sessionId)) return
  }
  // 读取失败时不发出一条无法建立核对边界的消息。
  const before = await sessionApi.getSessionDetail(sessionId)
  const pending: Submission = {...payload, afterSeq: before.last_seq ?? 0, state: 'sending'}
  writeDraft(scope, {submission: pending, sessionId})
  try {
    await sessionApi.chat(sessionId, payload)
    writeDraft(scope, {submission: undefined})
  } catch (error) {
    if (error instanceof ApiError && error.code >= 400 && error.code < 500 && error.code !== 408) {
      writeDraft(scope, {submission: undefined})
      throw error
    }
    writeDraft(scope, {submission: {...pending, state: 'unknown'}})
    if (await recoverSubmission(scope, sessionId)) return
  }
}


/** 项目首发原子受理；同创建标识可重放受理结果，不能产生第二个运行。 */
export async function startProjectRecoverably(scope:string, projectId:string, payload:Omit<Submission,'afterSeq'|'state'>):Promise<string> {
  const prior=readDraft(scope)
  const id=prior.sessionId || prior.creationId || crypto.randomUUID()
  if(prior.submission){if(await recoverSubmission(scope,id))return id}
  const pending:Submission={...payload,afterSeq:0,state:'sending'}
  writeDraft(scope,{creationId:id,sessionId:id,submission:pending})
  try {await projectApi.startChat(projectId,id,payload);writeDraft(scope,{submission:undefined});return id}
  catch(error){
    if(error instanceof ApiError && error.code>=400 && error.code<500 && error.code!==408){writeDraft(scope,{submission:undefined});throw error}
    writeDraft(scope,{submission:{...pending,state:'unknown'}})
    if(await recoverSubmission(scope,id))return id
    throw new UncertainSubmissionError()
  }
}
