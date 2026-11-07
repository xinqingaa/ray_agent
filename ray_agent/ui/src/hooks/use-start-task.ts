import {useState} from 'react'
import {toast} from 'sonner'
import {readDraft, writeDraft} from '@/lib/drafts'
import {sendRecoverably} from '@/lib/send-recovery'
import {ApiError} from '@/lib/api/fetch'
import {sessionApi} from '@/lib/api/session'
import type {FileInfo} from '@/lib/api/types'

export type StartOptions = {mode?: 'plan' | 'normal'; model?: string; reasoning?: string; skill?: {id: string; version: string}; image_mode?: 'auto' | 'files'}

/**
 * 首页输入发起一段新对话：草稿作用域决定会话归属（独立首页与各工作区首页各一份草稿），
 * 创建标识持久在草稿里，响应丢失后重试仍落到同一会话。
 */
export function useStartTask(scope: string, workspaceId: string | null, onStarted: (sessionId: string) => void) {
  const [sending, setSending] = useState(false)
  const start = async (message: string, files: FileInfo[], options?: StartOptions) => {
    if (sending) return
    setSending(true)
    try {
      let id = readDraft(scope).sessionId
      if (!id) {
        const creationId = readDraft(scope).creationId || crypto.randomUUID()
        writeDraft(scope, {creationId})
        const session = await sessionApi.createSession({creation_id: creationId, ...(workspaceId ? {workspace_id: workspaceId} : {})})
        id = session.session_id
        writeDraft(scope, {sessionId: id})
      }
      await sendRecoverably(scope, id, {
        message,
        attachments: files.map(file => file.id),
        mode: options?.mode ?? 'normal',
        image_mode: options?.image_mode ?? 'auto',
        skill: options?.skill,
        ...(options?.model && options?.reasoning ? {model: options.model, reasoning: options.reasoning} : {}),
      })
      onStarted(id)
    } catch (err) {
      if (!(err instanceof ApiError)) toast.error(err instanceof Error ? err.message : '创建会话失败')
      setSending(false)
      throw err
    }
  }
  return {sending, start}
}
