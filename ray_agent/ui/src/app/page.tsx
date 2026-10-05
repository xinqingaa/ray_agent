'use client'

import {useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {readDraft, writeDraft} from '@/lib/drafts'
import {sendRecoverably} from '@/lib/send-recovery'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import Link from 'next/link'
import {useSessions} from '@/hooks/use-sessions'
import {Button} from '@/components/ui/button'
import {BrandMark} from '@/components/brand-mark'
import {ApiError} from '@/lib/api/fetch'
import {sessionApi} from '@/lib/api/session'
import {formatSidebarTime} from '@/lib/utils'
import type {FileInfo} from '@/lib/api/types'

export default function Page() {
  const router = useRouter()
  const input=useRef<ChatInputRef>(null)
  const {sessions,loading,error,refresh}=useSessions()
  const examples=['调研一个近期行业趋势，核对原始来源并整理成简短报告。','我会上传一份 CSV，请核对数据质量，汇总关键指标并交付结果文件。','先制定一份活动筹备计划，列出任务、所需材料和需要我确认的信息。']
  const [sending, setSending] = useState(false)
  const startTask = async (message: string, files: FileInfo[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string}) => {
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
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl space-y-8">
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
          <ChatInput ref={input}
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

        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">快速开始</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {examples.map((example,index)=>(
              <button
                key={example}
                disabled={sending}
                className="group rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                onClick={()=>{
                  const current=input.current?.getInputValue().trim();
                  if(current && current!==example){
                    toast.message('输入框已有草稿，点击已选示例或先清空');
                    return
                  }
                  input.current?.setInputText(example)
                }}
              >
                <span className="mb-1.5 block text-sm font-medium text-foreground group-hover:text-primary">
                  {['调研报告','数据处理','任务规划'][index]}
                </span>
                <span className="text-xs text-muted-foreground">{example}</span>
              </button>
            ))}
          </div>
        </div>

        {(sessions.length > 0 || loading || error) && (
          <section className="space-y-3 border-t pt-6">
            <h2 className="text-sm font-medium text-muted-foreground">最近对话</h2>
            {loading && <p className="text-sm text-muted-foreground">正在读取最近对话</p>}
            {error && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-state-failed">{error}</p>
                <Button size="sm" variant="ghost" onClick={()=>void refresh()}>重试</Button>
              </div>
            )}
            {!loading && !error && sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">还没有对话，选择一个示例或描述你的目标即可开始。</p>
            )}
            {!loading && !error && sessions.length > 0 && (
              <div className="space-y-1">
                {sessions.slice(0,5).map(session=>{
                  const time = formatSidebarTime(session.latest_message_at)
                  return (
                  <Link
                    key={session.session_id}
                    href={`/sessions/${session.session_id}`}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || '新对话'}</span>
                    {time && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>}
                  </Link>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
