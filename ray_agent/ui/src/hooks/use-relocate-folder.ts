import {useCallback, useState} from 'react'
import {toast} from 'sonner'
import {useSessionTitleLookup} from '@/hooks/use-session-title'
import {workspaceApi} from '@/lib/api/workspace'
import type {WorkspaceItem} from '@/lib/api/types'
import {isDesktop, selectFolderGrant} from '@/lib/platform'
import {describeRelocateError} from '@/lib/workspace-relocate'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {useWorkspaces} from '@/providers/workspaces-provider'

/**
 * 把工作区改绑到另一个文件夹：宿主弹出原生选择器并登记一次性授权，界面把它交给核心的 relocate 接口。
 * 取消选择没有提示；成功后写回工作区并整体刷新文件树，核心已把变更订阅切到新位置；失败按原因给出明确文案。
 * 必须在工作区页内使用（读取变更订阅的刷新入口）。
 */
export function useRelocateFolder(workspace: WorkspaceItem) {
  const {workspaces, upsert, refresh} = useWorkspaces()
  const {requestRefresh} = useWorkspaceLive()
  const titleOf = useSessionTitleLookup()
  const [busy, setBusy] = useState(false)
  const available = isDesktop()

  const relocate = useCallback(async () => {
    if (!available || busy) return
    setBusy(true)
    try {
      const grant = await selectFolderGrant('relocate_workspace')
      if (!grant) return
      upsert(await workspaceApi.relocate(workspace, grant.grant_id))
      toast.success(`已重新定位到「${grant.name}」`)
      requestRefresh()
      void refresh()
    } catch (error) {
      const failure = describeRelocateError(error, {workspaces, titleOf})
      toast.error(failure.message)
      if (failure.refresh) void refresh()
    } finally {setBusy(false)}
  }, [available, busy, workspace, workspaces, titleOf, upsert, refresh, requestRefresh])

  return {relocate, busy, available}
}
