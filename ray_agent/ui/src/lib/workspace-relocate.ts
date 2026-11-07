import type {WorkspaceItem} from '@/lib/api/types'
import {leaseConflictText, leaseFromDetails} from '@/lib/workspace-changes'

type ErrorLike = {code?: unknown; message?: unknown; status?: unknown; details?: unknown}

export type RelocateFailure = {
  message: string
  /** 工作区本身已变化（别处改过、已不存在）：需要刷新工作区后再决定 */
  refresh: boolean
}

type Context = {
  /** 已加载的工作区，用来给“已绑定到哪个工作区”配名字 */
  workspaces: readonly Pick<WorkspaceItem, 'id' | 'name'>[]
  /** 占用写入的对话标题；读不到返回 null */
  titleOf: (sessionId: string | null | undefined) => string | null
}

/**
 * 重新定位失败的说明。核心的 409 靠 `details` 区分原因：目标已绑定其他工作区、标记属于本机另一个工作区、
 * 有写入租约、有活动运行，其余 409 是版本不符；400/403 是目标文件夹本身不能用（嵌套、数据根、系统目录等）。
 */
export function describeRelocateError(error: unknown, context: Context): RelocateFailure {
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike
  const details = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>
  const message = typeof e.message === 'string' && e.message ? e.message : '重新定位失败'
  if (e.code === 'conflict') {
    if (details.reason === 'already_bound') {
      const other = context.workspaces.find(item => item.id === details.workspace_id)
      return {message: `所选文件夹已经绑定到${other ? `工作区「${other.name}」` : '另一个工作区'}，一个文件夹只能属于一个工作区。请选择别的文件夹。`, refresh: false}
    }
    if (details.reason === 'marker_other_workspace') {
      const name = typeof details.workspace_name === 'string' && details.workspace_name ? `「${details.workspace_name}」` : '另一个工作区'
      return {message: `所选文件夹带有本机${name}的标记，不能作为这个工作区的新位置。请选择别的文件夹，或先处理那个工作区。`, refresh: false}
    }
    const lease = leaseFromDetails(details)
    if (lease) return {message: `文件夹正在被写入，暂时不能重新定位：${leaseConflictText(lease, context.titleOf(lease.owner_session_id))}`, refresh: false}
    if (typeof details.run_id === 'string') return {message: '这个工作区有对话正在运行，请先停止或等它结束后再重新定位。', refresh: false}
    return {message: '这个工作区刚在别处被修改，已刷新，请重试。', refresh: true}
  }
  if (e.code === 'gone') return {message: '文件夹选择已失效，请重新点击“重新定位”再选一次。', refresh: false}
  if (e.code === 'not_found') return {message: '这个工作区已经不存在。', refresh: true}
  if (e.code === 'forbidden' || e.code === 'invalid_request' || e.code === 'validation_failed') {
    return {message: `不能使用所选文件夹：${message}`, refresh: false}
  }
  return {message, refresh: false}
}
