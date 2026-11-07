import {useRef, type ReactNode} from 'react'
import {Link, useParams, useRouter} from '@/lib/navigation'
import {Outlet, useOutletContext} from 'react-router'
import {toast} from 'sonner'
import {FolderOpen} from 'lucide-react'
import {BrandMark} from '@/components/brand-mark'
import {ChatInput, type ChatInputRef} from '@/components/chat-input'
import {SessionDetailView} from '@/components/session-detail-view'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {WorkspaceBanners} from '@/components/workspace/workspace-banners'
import {WorkspaceBar} from '@/components/workspace/workspace-bar'
import {FolderPanel} from '@/components/workspace/folder-panel'
import {RunChangesBar} from '@/components/workspace/run-changes-bar'
import {useCanonicalSessionRoute} from '@/hooks/use-canonical-session-route'
import {useIsMobile} from '@/hooks/use-mobile'
import {useStartTask} from '@/hooks/use-start-task'
import {workspaceDraftScope} from '@/lib/drafts'
import type {WorkspaceItem} from '@/lib/api/types'
import {describeWorkspace} from '@/lib/workspace-state'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {WorkspaceLiveProvider} from '@/providers/workspace-live-provider'
import {useWorkspace, useWorkspaces} from '@/providers/workspaces-provider'

function Message({title, detail, children}: {title: string; detail?: string; children?: ReactNode}) {
  return <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <p className="text-sm font-medium">{title}</p>
    {detail && <p className="max-w-md text-meta text-muted-foreground">{detail}</p>}
    {children}
  </main>
}

/** 工作区路由的外壳：位置条与状态横幅，覆盖读取中、不存在、读取失败与正在删除。 */
export function WorkspaceLayout() {
  const {id = ''} = useParams()
  const lookup = useWorkspace(id)
  const {refresh} = useWorkspaces()

  if (lookup.phase === 'loading') return <div role="status" aria-label="正在读取工作区" className="space-y-3 p-6">
    <Skeleton className="h-6 w-48"/><Skeleton className="h-24 w-full max-w-(--reading-column)"/>
  </div>
  if (lookup.phase === 'missing') return <Message title="没有找到这个工作区" detail="它可能已被删除。绑定的文件夹和文件不受影响。">
    <Button asChild variant="outline" size="sm"><Link href="/">回到首页</Link></Button>
  </Message>
  if (lookup.phase === 'error') return <Message title="读取工作区失败" detail={lookup.message}>
    <Button variant="outline" size="sm" onClick={() => void refresh()}>重试</Button>
  </Message>
  const workspace = lookup.workspace
  if (workspace.status === 'deleting') return <Message title="这个工作区正在删除" detail="清理完成后会从列表中消失，文件夹与其中的文件不受影响。">
    <Button asChild variant="outline" size="sm"><Link href="/">回到首页</Link></Button>
  </Message>
  return <WorkspaceLiveProvider workspace={workspace}>
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceBar workspace={workspace}/>
      <WorkspaceBanners workspace={workspace}/>
      <div className="min-h-0 flex-1"><Outlet context={workspace}/></div>
    </div>
  </WorkspaceLiveProvider>
}

const useWorkspaceContext = () => useOutletContext<WorkspaceItem>()

/** 工作区首页：在这个工作区里发起新对话，右侧是文件夹面板。 */
export function WorkspaceHomePage() {
  const workspace = useWorkspaceContext()
  const router = useRouter()
  const isMobile = useIsMobile()
  const input = useRef<ChatInputRef>(null)
  const condition = describeWorkspace(workspace)
  const scope = workspaceDraftScope(workspace.id)
  const {sending, start} = useStartTask(scope, workspace.id, sid => router.push(workspaceSessionHref(workspace.id, sid)))

  return <div className="flex h-full min-h-0">
    <main className="flex min-w-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="my-auto w-full max-w-(--reading-column) shrink-0 space-y-6">
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <BrandMark className="size-7"/>
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight" dir="auto">{workspace.name}</h1>
          </div>
          {workspace.folder && <p className="flex items-center justify-center gap-1.5 text-meta text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" aria-hidden/><span className="min-w-0 break-all font-mono text-xs">{workspace.folder.path}</span>
          </p>}
        </div>
        {condition.archived
          ? <p role="status" className="rounded-lg border bg-muted/40 px-3.5 py-3 text-center text-sm text-muted-foreground">工作区已归档，不能发起新对话。取消归档后可以继续。</p>
          : <ChatInput ref={input} autoFocus draftScope={scope} onSend={start} disabled={sending}
              placeholder="在这个工作区里描述你想完成的事"
              commandHost={{
                hasSession: false, hasRuns: false, runStatus: 'idle', waitingApproval: false, waitingReply: false,
                submitting: sending, compacting: false,
                actions: {compact: () => toast.message('还没有可压缩的上下文')},
              }}/>}
      </div>
    </main>
    {!isMobile && <FolderPanel workspace={workspace} className="w-80 shrink-0 border-l"/>}
  </div>
}

/** 工作区里的会话：复用会话视图，右侧面板在文件夹与工作台之间切换；运行结束条带撤销入口。 */
export function WorkspaceSessionPage() {
  const workspace = useWorkspaceContext()
  const {sid = ''} = useParams()
  useCanonicalSessionRoute(sid, workspace.id)
  return <SessionDetailView key={sid} sessionId={sid} workspace={workspace}
    runFooter={runId => runId ? <RunChangesBar key={runId} workspace={workspace} runId={runId}/> : null}/>
}
