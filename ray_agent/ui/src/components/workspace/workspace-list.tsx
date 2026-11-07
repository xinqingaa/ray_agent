import {useState} from 'react'
import {FolderOpen, FolderPlus} from 'lucide-react'
import {Link} from '@/lib/navigation'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {useOpenFolder} from '@/hooks/use-open-folder'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {workspaceHref} from '@/lib/workspace-route'
import {CreateWorkspaceDialog} from './create-workspace-dialog'
import {WorkspaceStatus} from './workspace-status'

/** 首页的工作区入口：列表、新建与打开文件夹。独立对话的输入框在页面上方，不在这里。 */
export function WorkspaceList() {
  const {workspaces, loading, error, refresh} = useWorkspaces()
  const [creating, setCreating] = useState(false)
  const folder = useOpenFolder()

  return <section aria-labelledby="home-workspaces" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="home-workspaces" className="mr-auto text-sm font-medium">工作区</h2>
      <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}><FolderPlus aria-hidden/>新建工作区</Button>
      <Button type="button" variant="outline" size="sm" disabled={!folder.available || folder.busy} onClick={() => void folder.open()}
        title={folder.available ? undefined : '打开文件夹需要在 RayAgent 桌面应用中使用'}>
        <FolderOpen aria-hidden/>{folder.busy ? '正在打开' : '打开文件夹'}
      </Button>
    </div>
    {!folder.available && <p className="text-meta text-muted-foreground">当前不在桌面应用中，不能选择本地文件夹；仍可新建工作区。</p>}

    {loading && !workspaces.length && <div className="space-y-2" role="status" aria-label="正在读取工作区">
      <Skeleton className="h-14 w-full"/><Skeleton className="h-14 w-full"/>
    </div>}
    {error && <div role="alert" className="flex items-center gap-2 text-sm text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button></div>}
    {!loading && !error && !workspaces.length && <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      还没有工作区。新建一个，或打开已有的文件夹，在其中分多次对话推进同一件事。
    </p>}
    {workspaces.length > 0 && <ul className="divide-y rounded-lg border bg-card">
      {workspaces.map(workspace => <li key={workspace.id}>
        <Link href={workspaceHref(workspace.id)} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" dir="auto">{workspace.name}</span>
            <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground" title={workspace.folder?.path}>{workspace.folder?.path ?? '没有绑定文件夹'}</span>
          </span>
          <WorkspaceStatus workspace={workspace}/>
        </Link>
      </li>)}
    </ul>}
    <CreateWorkspaceDialog open={creating} onOpenChange={setCreating}/>
    {folder.dialog}
  </section>
}
