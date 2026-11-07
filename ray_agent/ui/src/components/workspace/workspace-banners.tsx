import {useState, useSyncExternalStore} from 'react'
import {toast} from 'sonner'
import {Link, useParams} from '@/lib/navigation'
import {Button} from '@/components/ui/button'
import {formatBytes} from '@/components/run/format'
import {useRelocateFolder} from '@/hooks/use-relocate-folder'
import {useSessionTitle} from '@/hooks/use-session-title'
import {historyApi, workspaceApi} from '@/lib/api/workspace'
import {leaseConflictText, leaseNotice} from '@/lib/workspace-changes'
import {workspaceSessionHref} from '@/lib/workspace-route'
import type {WorkspaceItem} from '@/lib/api/types'
import {clearOpenNotice, readOpenNotice, subscribeOpenNotice} from '@/lib/workspace-notice'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {describeWorkspace, formatScan} from '@/lib/workspace-state'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {useWorkspaces} from '@/providers/workspaces-provider'

const BAR = 'flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2 text-sm'

/** 文件夹不可用：对话仍可继续，文件工具与文件夹面板暂停；给出重新检查与重新定位。 */
function UnavailableBanner({workspace}: {workspace: WorkspaceItem}) {
  const {upsert} = useWorkspaces()
  const {unavailableReason} = useWorkspaceLive()
  const [checking, setChecking] = useState(false)
  const relocate = useRelocateFolder(workspace)

  const recheck = async () => {
    setChecking(true)
    try {
      const next = await workspaceApi.recheck(workspace.id)
      upsert(next)
      if (next.folder?.status !== 'available') toast.message('文件夹仍然不可用')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '检查失败')
    } finally {setChecking(false)}
  }

  return <div role="status" className={`${BAR} bg-state-waiting-soft`}>
    <span className="min-w-0 flex-1">
      {workspace.folder ? <>文件夹暂时不可用：<span className="break-all font-mono text-xs">{workspace.folder.path}</span>。{unavailableReason ? `${unavailableReason}。` : ''}</> : '这个工作区没有绑定文件夹。'}
      对话仍可继续，读写文件的操作暂停。
    </span>
    <Button variant="ghost" size="sm" disabled={checking} onClick={() => void recheck()}>{checking ? '正在检查' : '重新检查'}</Button>
    {relocate.available && <Button variant="ghost" size="sm" disabled={relocate.busy} onClick={() => void relocate.relocate()}>{relocate.busy ? '正在重新定位' : '重新定位'}</Button>}
  </div>
}

function ArchivedBanner({workspace}: {workspace: WorkspaceItem}) {
  const {upsert, refresh} = useWorkspaces()
  const [busy, setBusy] = useState(false)
  const restore = async () => {
    setBusy(true)
    try {
      upsert(await workspaceApi.unarchive(workspace))
      toast.success('已取消归档')
    } catch (error) {
      reportWorkspaceError(error, '取消归档失败', () => void refresh())
    } finally {setBusy(false)}
  }
  return <div role="status" className={`${BAR} bg-muted`}>
    <span className="min-w-0 flex-1">这个工作区已归档，对话与文件夹只读。</span>
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void restore()}>取消归档</Button>
  </div>
}

/**
 * 写入租约提示：别的对话（或文件夹自己的写入）占着文件夹时说明是谁，可跳转到那个对话；
 * 停止后未能确认写入结束（blocked）时给出“重试收尾”。自己的对话正常写入时不提示。
 */
function WriteLeaseNotice({workspace}: {workspace: WorkspaceItem}) {
  const {sid = null} = useParams()
  const {lease, refreshLease} = useWorkspaceLive()
  const [busy, setBusy] = useState(false)
  const owner = lease?.owner_session_id || null
  const title = useSessionTitle(owner)
  const notice = leaseNotice(lease, sid)
  if (!lease || !notice) return null

  const retry = async () => {
    setBusy(true)
    try {
      await historyApi.retrySettle(workspace.id)
      toast.success('已确认写入结束，文件夹可以再次写入')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试收尾失败')
    } finally {
      setBusy(false)
      void refreshLease()
    }
  }

  const text = leaseConflictText(lease, title)
  return <div role="status" className={`${BAR} bg-state-waiting-soft`}>
    <span className="min-w-0 flex-1">{text}</span>
    {owner && owner !== sid && <Button asChild variant="ghost" size="sm"><Link href={workspaceSessionHref(workspace.id, owner)}>查看对话</Link></Button>}
    {notice.kind === 'blocked' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void retry()}>{busy ? '正在收尾' : '重试收尾'}</Button>}
  </div>
}

/** 打开文件夹后的一次性扫描摘要，关闭后不再出现。 */
function ScanNotice({workspaceId}: {workspaceId: string}) {
  const notice = useSyncExternalStore(subscribeOpenNotice, () => readOpenNotice(workspaceId))
  if (!notice?.scan) return null
  return <div role="status" className={`${BAR} bg-muted`}>
    <span className="min-w-0 flex-1">已打开文件夹，共 {formatScan(notice.scan, formatBytes)}。</span>
    <Button variant="ghost" size="sm" onClick={clearOpenNotice}>知道了</Button>
  </div>
}

export function WorkspaceBanners({workspace}: {workspace: WorkspaceItem}) {
  const condition = describeWorkspace(workspace)
  return <>
    {condition.archived && <ArchivedBanner workspace={workspace}/>}
    {!condition.archived && !condition.deleting && !condition.folderAvailable && <UnavailableBanner workspace={workspace}/>}
    {!condition.deleting && <WriteLeaseNotice workspace={workspace}/>}
    <ScanNotice workspaceId={workspace.id}/>
  </>
}
