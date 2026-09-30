'use client'

import {useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {readDraft, writeDraft} from '@/lib/drafts'
import {sendRecoverably} from '@/lib/send-recovery'
import {ChatInput} from '@/components/chat-input'
import {BrandMark} from '@/components/brand-mark'
import {ApiError} from '@/lib/api/fetch'
import {sessionApi} from '@/lib/api/session'
import type {FileInfo} from '@/lib/api/types'

export default function Page() {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const startTask = async (message: string, files: FileInfo[], options?: {mode?: 'plan' | 'normal'}) => {
    if (sending) return
    setSending(true)
    try {
      let id = readDraft('independent').sessionId
      if (!id) {
        const session = await sessionApi.createSession()
        id = session.session_id
        writeDraft('independent', {sessionId: id})
      }
      await sendRecoverably('independent', id, {
        message,
        attachments: files.map((file) => file.id),
        mode: options?.mode ?? 'normal',
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
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7"/>
            <h1 className="text-xl font-medium">想在 RayAgent 中做什么</h1>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            描述目标，或说明要交付的文件。
          </p>
        </div>
        <div className="mt-6">
          <ChatInput
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
