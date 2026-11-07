import {useCallback, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {useRouter} from '@/lib/navigation'
import {isDesktop, selectFolderGrant} from '@/lib/platform'
import {workspaceApi} from '@/lib/api/workspace'
import type {ConflictResolution, MarkerConflict, OpenWorkspaceResult} from '@/lib/api/types'
import {setOpenNotice} from '@/lib/workspace-notice'
import {workspaceHref} from '@/lib/workspace-route'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {MarkerConflictDialog} from '@/components/workspace/marker-conflict-dialog'

const RECOGNIZED_TEXT = {
  moved: '已认出这是原来的工作区，位置已更新',
  existing: '这个文件夹已经是工作区，已为你打开',
} as const

/**
 * 打开已有文件夹为工作区：宿主弹出原生选择器并登记授权，界面只拿一次性凭证交给核心。
 * 认回、复制冲突与扫描摘要在这里统一处理；`dialog` 须渲染在调用方树里。
 * 把已有工作区改绑到别的文件夹是另一条路径，见 `useRelocateFolder`。
 */
export function useOpenFolder() {
  const router = useRouter()
  const {upsert, refresh} = useWorkspaces()
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<MarkerConflict | null>(null)
  const available = isDesktop()

  const settle = useCallback((result: OpenWorkspaceResult) => {
    if (result.status === 'conflict' && result.conflict) {setConflict(result.conflict); return}
    if (!result.workspace) throw new Error('核心没有返回工作区')
    upsert(result.workspace)
    setOpenNotice({workspaceId: result.workspace.id, scan: result.scan ?? null, recognized: result.recognized ?? null})
    if ((result.recognized === 'moved' || result.recognized === 'existing')) toast.message(RECOGNIZED_TEXT[result.recognized])
    void refresh()
    router.push(workspaceHref(result.workspace.id))
  }, [router, upsert, refresh])

  const open = useCallback(async () => {
    if (!available || busy) return
    setBusy(true)
    try {
      const grant = await selectFolderGrant('open_workspace')
      if (!grant) return
      settle(await workspaceApi.open(grant.grant_id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开文件夹失败')
    } finally {setBusy(false)}
  }, [available, busy, settle])

  const resolve = useCallback(async (resolution: ConflictResolution) => {
    if (!conflict) return
    setBusy(true)
    try {
      const result = await workspaceApi.resolveConflict(conflict.conflict_id, resolution)
      setConflict(null)
      settle(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理失败，请重新打开文件夹')
      setConflict(null)
    } finally {setBusy(false)}
  }, [conflict, settle])

  const dialog: ReactNode = <MarkerConflictDialog conflict={conflict} busy={busy} onResolve={resolution => void resolve(resolution)} onCancel={() => setConflict(null)}/>
  return {open, busy, available, dialog}
}
