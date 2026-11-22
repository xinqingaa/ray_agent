import {toast} from 'sonner'
import {ApiError} from '@/lib/api/fetch'
import type {WorkspaceItem} from '@/lib/api/types'
import {workspaceApi} from '@/lib/api/workspace'

/** 工作区修改带版本核对：别处已改过时提示刷新后重试，其余错误原样显示。 */
export function reportWorkspaceError(error: unknown, fallback: string, refresh: () => void) {
  if (error instanceof ApiError && error.code === 'conflict') {
    toast.error('这个工作区刚在别处被修改，已刷新，请重试')
    refresh()
    return
  }
  toast.error(error instanceof Error ? error.message : fallback)
}

export async function toggleWorkspaceArchive(workspace: WorkspaceItem, upsert: (item: WorkspaceItem) => void, refresh: () => void) {
  const archived = workspace.status === 'archived'
  try {
    upsert(archived ? await workspaceApi.unarchive(workspace) : await workspaceApi.archive(workspace))
    toast.success(archived ? '已取消归档' : '已归档，对话变为只读')
  } catch (error) {
    reportWorkspaceError(error, archived ? '取消归档失败' : '归档失败', refresh)
  }
}

/** 本机执行开关：工作区栏与工作区行菜单共用。归档或删除中的工作区不能修改。 */
export async function toggleWorkspaceExecution(workspace: WorkspaceItem, enabled: boolean, upsert: (item: WorkspaceItem) => void, refresh: () => void) {
  try {
    upsert(await workspaceApi.setLocalExecution(workspace, enabled))
    toast.success(enabled ? '已启用本机执行' : '已关闭本机执行')
  } catch (error) {
    reportWorkspaceError(error, '更新本机执行开关失败', refresh)
  }
}
