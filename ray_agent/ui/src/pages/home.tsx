import {useRef} from 'react'
import {useRouter} from '@/lib/navigation'
import {toast} from 'sonner'
import {INDEPENDENT_SCOPE} from '@/lib/drafts'
import {useStartTask} from '@/hooks/use-start-task'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {TaskLayout} from '@/components/task-layout'

export function HomePage() {
  const router = useRouter()
  const input = useRef<ChatInputRef>(null)
  const {sending, start} = useStartTask(INDEPENDENT_SCOPE, null, id => router.push(`/sessions/${id}`))

  return (
    <TaskLayout attach={sending ? undefined : files => input.current?.addFiles(files)}>
    <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="my-auto w-full max-w-(--reading-column) shrink-0 space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-[clamp(1.5rem,3vw,2.1rem)] font-semibold tracking-tight">想完成什么？</h1>
          <p className="text-sm text-muted-foreground">独立对话不读写任何工作区的文件和记忆。</p>
        </div>

        <section aria-label="独立对话" className="space-y-4">
          <ChatInput ref={input} autoFocus
            draftScope={INDEPENDENT_SCOPE}
            onSend={start}
            disabled={sending}
            placeholder="描述目标，或拖入材料"
            commandHost={{
              hasSession: false,
              hasRuns: false,
              runStatus: 'idle',
              waitingApproval: false,
              waitingReply: false,
              submitting: sending,
              compacting: false,
              actions: {compact: () => toast.message('还没有可压缩的上下文')},
            }}
          />
        </section>

      </div>
    </main>
    </TaskLayout>
  )
}
