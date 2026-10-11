'use client'

import {useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {readDraft, writeDraft} from '@/lib/drafts'
import {sendRecoverably} from '@/lib/send-recovery'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {BrandMark} from '@/components/brand-mark'
import {ApiError} from '@/lib/api/fetch'
import {sessionApi} from '@/lib/api/session'
import type {FileInfo} from '@/lib/api/types'

export default function Page() {
  const router = useRouter()
  const input=useRef<ChatInputRef>(null)
  const [sending, setSending] = useState(false)
  const startTask = async (message: string, files: FileInfo[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string; image_mode?: 'auto' | 'files'}) => {
    if (sending) return
    setSending(true)
    try {
      let id = readDraft('independent').sessionId
      if (!id) {
        const creationId=readDraft('independent').creationId || crypto.randomUUID()
        writeDraft('independent',{creationId})
        const session = await sessionApi.createSession({creation_id:creationId})
        id = session.session_id
        writeDraft('independent', {sessionId: id})
      }
      await sendRecoverably('independent', id, {
        message,
        attachments: files.map((file) => file.id),
        mode: options?.mode ?? 'normal',
        image_mode: options?.image_mode ?? 'auto',
        ...(options?.model && options?.reasoning ? {model: options.model, reasoning: options.reasoning} : {}),
      })
      router.push(`/sessions/${id}`)
    } catch (err) {
      if (!(err instanceof ApiError)) {
        toast.error(err instanceof Error ? err.message : '创建会话失败')
      }
      setSending(false)
      throw err
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="my-auto w-full max-w-(--reading-column) shrink-0 space-y-8">
        <div className="space-y-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <BrandMark className="size-8"/>
            <h1 className="text-2xl font-semibold tracking-tight">RayAgent</h1>
          </div>
          <p className="text-base text-muted-foreground">
            描述你的目标，或说明要交付的文件
          </p>
        </div>

        <div className="space-y-4">
          <ChatInput ref={input} autoFocus
            draftScope="independent"
            onSend={startTask}
            disabled={sending}
            placeholder="描述你想完成的任务"
            commandHost={{
              hasSession: false,
              hasRuns: false,
              runStatus: 'idle',
              waitingApproval: false,
              waitingReply: false,
              submitting: sending,
              compacting: false,
              projectsEnabled: true,
              projectBindable: true,
              actions: {compact: () => toast.message('还没有可压缩的上下文')},
            }}
          />
        </div>

      </div>
    </main>
  )
}
