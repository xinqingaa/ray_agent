import {toast} from 'sonner'
import {ApiError} from '@/lib/api/fetch'

/** 工作区修改带版本核对：别处已改过时提示刷新后重试，其余错误原样显示。 */
export function reportWorkspaceError(error: unknown, fallback: string, refresh: () => void) {
  if (error instanceof ApiError && error.code === 'conflict') {
    toast.error('这个工作区刚在别处被修改，已刷新，请重试')
    refresh()
    return
  }
  toast.error(error instanceof Error ? error.message : fallback)
}
