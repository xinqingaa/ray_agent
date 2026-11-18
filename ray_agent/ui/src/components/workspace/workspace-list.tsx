import {useState} from 'react'
import {Folder, FolderOpen, FolderPlus, Plus} from '@/components/ui/icons'
import {Link} from '@/lib/navigation'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {useOpenFolder} from '@/hooks/use-open-folder'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {workspaceHref} from '@/lib/workspace-route'
import {CreateWorkspaceDialog} from './create-workspace-dialog'
import {WorkspaceStatus} from './workspace-status'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'

export function WorkspaceAddAction() {
  const [creating, setCreating] = useState(false)
  const folder = useOpenFolder()
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="添加工作区" title="添加工作区"><Plus/></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setCreating(true)}><FolderPlus/>新建工作区</DropdownMenuItem>
        <DropdownMenuItem disabled={!folder.available || folder.busy} onSelect={() => void folder.open()}><FolderOpen/>打开文件夹</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <CreateWorkspaceDialog open={creating} onOpenChange={setCreating}/>
    {folder.dialog}
  </>
}

/** 主纸面的工作区目录和空态，使用与左侧添加入口相同的创建与授权流程。 */
export function WorkspaceList() {
  const {workspaces, loading, error, refresh} = useWorkspaces()
  const [creating, setCreating] = useState(false)
  const folder = useOpenFolder()

  const empty = !loading && !error && workspaces.length === 0
  const actions = <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={empty ? 'default' : 'outline'} onClick={() => setCreating(true)}><FolderPlus/>新建工作区</Button>
      <Button type="button" variant="outline" disabled={!folder.available || folder.busy} onClick={() => void folder.open()}
        title={folder.available ? undefined : '打开文件夹需要在 RayAgent 桌面应用中使用'}>
        <FolderOpen/>{folder.busy ? '正在打开' : '打开文件夹'}
      </Button>
  </div>
  const folderHint = !folder.available && <p className="text-meta text-muted-foreground">打开本地文件夹需要 RayAgent 桌面应用。</p>

  return <>
    {empty ? <section aria-labelledby="workspace-empty-title" className="m-auto flex max-w-lg flex-col items-center gap-4 px-3 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-muted text-muted-foreground"><Folder className="size-6"/></span>
      <div className="space-y-1.5">
        <h1 id="workspace-empty-title" className="text-[clamp(1.35rem,3vw,1.8rem)] font-semibold tracking-tight">从一个文件夹开始</h1>
        <p className="text-sm text-muted-foreground">工作区把同一个文件夹里的材料、对话和成果放在一起。</p>
      </div>
      <div className="[&>div]:justify-center">{actions}</div>
      {folderHint}
    </section> : <section aria-labelledby="workspace-directory-title" className="mx-auto w-full max-w-(--reading-column) space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="workspace-directory-title" className="text-[1.375rem] font-semibold tracking-tight">工作区</h1>
        {actions}
      </div>
      {folderHint}
      {loading && !workspaces.length && <div className="space-y-2" role="status" aria-label="正在读取工作区">
        <Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/>
      </div>}
      {error && <div role="alert" className="flex items-center gap-2 text-sm text-state-failed">
        {error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重试</Button>
      </div>}
      {workspaces.length > 0 && <ul className="space-y-1">
        {workspaces.map(workspace => <li key={workspace.id}>
          <Link href={workspaceHref(workspace.id)} className="workspace-directory-row gap-3 px-3 py-2">
            <Folder className="size-[19px] shrink-0 text-muted-foreground"/>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" dir="auto">{workspace.name}</span>
              {workspace.folder && <span className="block truncate font-mono text-xs text-faint" title={workspace.folder.path}>{workspace.folder.path}</span>}
            </span>
            <WorkspaceStatus workspace={workspace} compact/>
          </Link>
        </li>)}
      </ul>}
    </section>}
    <CreateWorkspaceDialog open={creating} onOpenChange={setCreating}/>
    {folder.dialog}
  </>
}
