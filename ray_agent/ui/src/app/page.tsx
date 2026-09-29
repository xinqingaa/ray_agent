'use client'

import {useMemo, useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {ChatInput} from '@/components/chat-input'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {SessionItem} from '@/components/session-item'
import {useSessions} from '@/hooks/use-sessions'
import {sessionApi} from '@/lib/api/session'
import type {FileInfo, Session} from '@/lib/api/types'

/** 自评测任务的可直接发送改写：不要求先上传文件 */
const EXAMPLES = [
  {
    title: '记住一个校验词',
    text: '记住本会话的校验词是青松。记住之后，用一句话复述这个词。',
  },
  {
    title: '统计并交付文件',
    text: '在工作目录创建 source.csv，内容为表头 item,amount，以及 a,12、b,18、c,30 三行。统计 amount 的总和，写入 summary.json，并交付这个文件供我下载。不要修改 source.csv。',
  },
  {
    title: '先提问再继续',
    text: '我需要一份结果文件。请先问我文件名，等我回复后，把 1 到 10 的平方和写进那个文件，并交付给我下载。',
  },
]

function sessionTime(session: Session): number {
  const raw = session.latest_message_at
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export default function Page() {
  const router = useRouter()
  const {sessions, loading, error, refresh, deleteSession, patchSession} = useSessions()
  const [sending, setSending] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [pendingRename, setPendingRename] = useState<Session | null>(null)

  const recent = useMemo(
    () => [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a)).slice(0, 8),
    [sessions],
  )

  const startTask = async (message: string, files: FileInfo[]) => {
    if (sending) return
    setSending(true)
    try {
      const session = await sessionApi.createSession()
      const payload = JSON.stringify({message, attachments: files.map((file) => file.id)})
      const encoded = btoa(encodeURIComponent(payload))
      router.push(`/sessions/${session.session_id}?init=${encoded}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建会话失败')
      setSending(false)
      throw err
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-medium">想在 RayAgent 中做什么</h1>
          <p className="mt-1 text-meta text-muted-foreground">
            写明目标和要交付的文件。发送后进入会话，运行状态、计划和工具会出现在那里。
          </p>
        </div>

        <ChatInput onSend={startTask} disabled={sending} placeholder="描述一个任务，或从下面接着最近的会话"/>

        {loading && sessions.length === 0 ? (
          <p className="text-meta text-muted-foreground">正在读取会话</p>
        ) : error && sessions.length === 0 ? (
          <div className="flex flex-col gap-2 text-meta">
            <p className="text-state-failed">{error}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="w-fit rounded-sm text-signal underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重新读取
            </button>
          </div>
        ) : recent.length === 0 ? (
          <section aria-label="示例任务">
            <h2 className="text-sm font-medium">还没有会话</h2>
            <p className="mt-1 text-meta text-faint">
              发送任务后，会话会出现在左侧列表，并标出运行中、等你处理（回复提问或批准操作）或失败。下面三条可以直接发送。
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <li key={example.title}>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void startTask(example.text, [])}
                    className="w-full rounded-lg border bg-card px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <span className="block text-sm font-medium">{example.title}</span>
                    <span className="mt-1 block text-meta text-muted-foreground">{example.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section aria-label="最近会话">
            <h2 className="mb-2 text-sm font-medium">最近会话</h2>
            <ul className="flex flex-col">
              {recent.map((session) => (
                <li key={session.session_id}>
                  <SessionItem
                    session={session}
                    isActive={false}
                    onClick={(id) => router.push(`/sessions/${id}`)}
                    onDelete={setPendingDelete}
                    onRename={setPendingRename}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <DeleteSessionDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        onConfirm={async () => {
          if (!pendingDelete) return
          const title = pendingDelete.title || '新任务'
          const ok = await deleteSession(pendingDelete.session_id)
          if (ok) toast.success(`已删除任务「${title}」`)
          else toast.error(`删除任务「${title}」失败，请重试`)
          setPendingDelete(null)
        }}
      />
      {pendingRename && <RenameSessionDialog session={pendingRename} open
        onOpenChange={(open) => {if (!open) setPendingRename(null)}}
        onSaved={(title) => patchSession(pendingRename.session_id, {title})}/>}
    </div>
  )
}
