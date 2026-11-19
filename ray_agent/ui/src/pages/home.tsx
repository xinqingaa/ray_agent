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
      <main className="task-home" aria-labelledby="independent-home-title">
        <div className="task-home-content">
          <header className="task-home-heading">
            <h1 id="independent-home-title">想完成什么？</h1>
            <p>独立对话不读写任何工作区的文件和记忆。</p>
          </header>
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
        </div>
      </main>
    </TaskLayout>
  )
}
