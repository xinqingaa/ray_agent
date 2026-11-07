import {useRef} from 'react'
import {useRouter} from '@/lib/navigation'
import {toast} from 'sonner'
import {INDEPENDENT_SCOPE} from '@/lib/drafts'
import {useStartTask} from '@/hooks/use-start-task'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {BrandMark} from '@/components/brand-mark'
import {WorkspaceList} from '@/components/workspace/workspace-list'

export function HomePage() {
  const router = useRouter()
  const input = useRef<ChatInputRef>(null)
  const {sending, start} = useStartTask(INDEPENDENT_SCOPE, null, id => router.push(`/sessions/${id}`))

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

        <section aria-label="独立对话" className="space-y-4">
          <ChatInput ref={input} autoFocus
            draftScope={INDEPENDENT_SCOPE}
            onSend={start}
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
              actions: {compact: () => toast.message('还没有可压缩的上下文')},
            }}
          />
        </section>

        <WorkspaceList/>
      </div>
    </main>
  )
}
