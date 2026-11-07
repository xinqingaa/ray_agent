import type {WorkspaceItem} from '@/lib/api/types'

/**
 * 工作区在界面上的状态：归档只读；文件夹不可用时会话仍可读写对话，文件工具与文件夹面板暂停。
 */
export type WorkspaceCondition = {
  /** 列表与面板上的状态词 */
  label: '可用' | '不可用' | '已归档' | '正在删除'
  archived: boolean
  deleting: boolean
  /** 文件夹现在能被读取；没有登记文件夹时同样为假 */
  folderAvailable: boolean
  /** 可以新建会话、向文件夹添加文件 */
  writable: boolean
}

export function describeWorkspace(workspace: WorkspaceItem): WorkspaceCondition {
  const archived = workspace.status === 'archived'
  const deleting = workspace.status === 'deleting'
  const folderAvailable = workspace.folder?.status === 'available'
  return {
    label: deleting ? '正在删除' : archived ? '已归档' : folderAvailable ? '可用' : '不可用',
    archived, deleting, folderAvailable,
    writable: !archived && !deleting && folderAvailable,
  }
}

/**
 * 会话列表的服务端过滤参数：工作区内只列该工作区的会话，独立对话只列没有工作区的（两者不能同用）。
 * 不传范围的调用（如退出前统计活动任务）得到全部会话。
 */
export type SessionScope = {workspaceId: string} | {independent: true}

export function sessionScope(workspaceId: string | null | undefined): SessionScope {
  return workspaceId ? {workspaceId} : {independent: true}
}

export function sessionScopeParams(scope: SessionScope | undefined): Record<string, string | boolean> {
  if (!scope) return {}
  return 'workspaceId' in scope ? {workspace_id: scope.workspaceId} : {independent: true}
}

/** 工作区列表排序：可用在前、归档在后，同组按更新时间倒序。 */
export function sortWorkspaces(items: WorkspaceItem[]): WorkspaceItem[] {
  const rank = (item: WorkspaceItem) => item.status === 'archived' ? 2 : item.folder?.status === 'available' ? 0 : 1
  return [...items].sort((a, b) => rank(a) - rank(b) || b.updated_at - a.updated_at || a.name.localeCompare(b.name, 'zh'))
}

export function formatScan(scan: {files: number; directories: number; bytes: number; truncated: boolean}, formatBytes: (n: number) => string): string {
  const count = scan.truncated ? `至少 ${scan.files} 个文件` : `${scan.files} 个文件`
  return `${count}，${formatBytes(scan.bytes)}${scan.truncated ? '（扫描已达上限，实际规模更大）' : ''}`
}
