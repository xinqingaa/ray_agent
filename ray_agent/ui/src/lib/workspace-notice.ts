import type {ScanSummary} from '@/lib/api/types'

/** 打开文件夹后在工作区页展示一次的扫描摘要；跨页面跳转时暂存，页面读取后清除。 */
export type OpenNotice = {workspaceId: string; scan: ScanSummary | null; recognized: 'new' | 'existing' | 'moved' | null}

let pending: OpenNotice | null = null
const listeners = new Set<() => void>()

export function setOpenNotice(notice: OpenNotice) {pending = notice; listeners.forEach(listener => listener())}
export const readOpenNotice = (workspaceId: string) => pending?.workspaceId === workspaceId ? pending : null
export function clearOpenNotice() {pending = null; listeners.forEach(listener => listener())}
export function subscribeOpenNotice(listener: () => void) {
  listeners.add(listener)
  return () => {listeners.delete(listener)}
}
