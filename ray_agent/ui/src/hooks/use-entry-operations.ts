import {useCallback, useMemo} from 'react'
import {useSessionTitleLookup} from '@/hooks/use-session-title'
import {ApiError} from '@/lib/api/fetch'
import {rootApi} from '@/lib/api/workspace'
import type {RootEntry} from '@/lib/api/types'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import {parentDirectory} from '@/lib/workspace-changes'
import {entryFailureText, entryVersionOf, type OperationFailure} from '@/lib/workspace-entries'

/**
 * 文件夹条目操作的入口：删除、重命名、新建文件夹。文件树的行菜单、就地编辑与第 4 批的右键菜单都调用这里。
 *
 * 每个操作失败时抛出带中文说明的 Error（租约占用时说明占用者）；成功后重读所在目录并请求刷新最近修改。
 * 调用方决定失败的展示位置（就地编辑的提示或确认弹框内）。
 */
export type EntryOperations = {
  remove: (path: string, entry: RootEntry) => Promise<void>
  rename: (path: string, entry: RootEntry, name: string) => Promise<void>
  createFolder: (directory: string, name: string) => Promise<void>
}

export function useEntryOperations(rootId: string | null, reloadDirectory: (path: string) => void): EntryOperations {
  const live = useWorkspaceLive()
  const titleOf = useSessionTitleLookup()

  const fail = useCallback((error: unknown): Error => {
    if (error instanceof ApiError) {
      const failure: OperationFailure = {code: error.code, message: error.message, details: error.details}
      if (error.code === 'conflict') void live.refreshLease()
      return new Error(entryFailureText(failure, titleOf))
    }
    return error instanceof Error ? error : new Error('操作失败，请重试')
  }, [live, titleOf])

  const settle = useCallback((directory: string) => {
    reloadDirectory(directory)
    live.requestRefresh()
  }, [live, reloadDirectory])

  return useMemo<EntryOperations>(() => ({
    async remove(path, entry) {
      if (!rootId) throw new Error('当前无法修改工作区文件夹')
      if (entry.kind === 'file' && !entryVersionOf(entry)) throw new Error('这个文件的版本未知，请刷新后再试')
      try {
        await rootApi.remove(rootId, path, entryVersionOf(entry))
      } catch (error) {
        throw fail(error)
      }
      settle(parentDirectory(path))
    },
    async rename(path, entry, name) {
      if (!rootId) throw new Error('当前无法修改工作区文件夹')
      const version = entryVersionOf(entry)
      if (!version) throw new Error('这个文件的版本未知，请刷新后再试')
      try {
        await rootApi.rename(rootId, path, name, version)
      } catch (error) {
        throw fail(error)
      }
      settle(parentDirectory(path))
    },
    async createFolder(directory, name) {
      if (!rootId) throw new Error('当前无法修改工作区文件夹')
      try {
        await rootApi.createFolder(rootId, directory, name)
      } catch (error) {
        throw fail(error)
      }
      settle(directory)
    },
  }), [rootId, fail, settle])
}
