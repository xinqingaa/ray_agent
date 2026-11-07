import {useCallback, useEffect, useRef, useState} from 'react'
import {rootApi} from '@/lib/api/workspace'
import {directoriesToReload, type ChangeBatch} from '@/lib/workspace-changes'
import {
  applyError, applyListing, beginLoad, EMPTY_TREE, pendingDirectories, pruneMissing, setExpanded, type TreeState,
} from '@/lib/workspace-tree'

/** 回到前台时至少间隔这么久才重新列目录 */
const FOCUS_RELOAD_MS = 5000

/**
 * 文件夹面板的树：按目录懒加载。`enabled` 为假（文件夹不可用）时不读取。
 * `change.signal` 变化时按这一批外部变更重新列目录：只读变化条目所在的已读取目录，整体刷新（`batch.refresh`）时读根与
 * 全部已展开目录；展开状态保留。
 */
export function useFolderTree(rootId: string | null, enabled: boolean, change?: {signal: number; batch: ChangeBatch}) {
  const [tree, setTree] = useState<TreeState>(EMPTY_TREE)
  const rootRef = useRef(rootId)
  const generation = useRef(0)
  const lastLoad = useRef(0)
  const treeRef = useRef(tree)
  treeRef.current = tree

  // 换了根（切换工作区或重新绑定）就丢弃旧树
  useEffect(() => {
    if (rootRef.current !== rootId) {
      rootRef.current = rootId
      generation.current++
      setTree(EMPTY_TREE)
    }
  }, [rootId])

  const load = useCallback(async (path: string) => {
    if (!rootId) return
    const token = generation.current
    setTree(current => beginLoad(current, path))
    try {
      const listing = await rootApi.entries(rootId, path)
      if (token !== generation.current) return
      lastLoad.current = Date.now()
      setTree(current => pruneMissing(applyListing(current, path, listing), path))
    } catch (error) {
      if (token !== generation.current) return
      setTree(current => applyError(current, path, error instanceof Error ? error.message : '读取目录失败'))
    }
  }, [rootId])

  const reload = useCallback(() => {
    const current = treeRef.current
    for (const path of ['', ...current.expanded]) void load(path)
  }, [load])

  // 首次进入与展开新目录：读取尚未读到的目录
  useEffect(() => {
    if (!enabled || !rootId) return
    for (const path of pendingDirectories(tree)) void load(path)
  }, [enabled, rootId, tree, load])

  const signal = change?.signal ?? 0
  const batchRef = useRef(change?.batch)
  batchRef.current = change?.batch
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {first.current = false; return}
    const batch = batchRef.current
    if (!enabled || !batch) return
    for (const path of directoriesToReload(batch, ['', ...treeRef.current.expanded])) void load(path)
  }, [signal]) // eslint-disable-line react-hooks/exhaustive-deps -- 只由信号触发

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - lastLoad.current > FOCUS_RELOAD_MS) reload()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, reload])

  const toggle = useCallback((path: string, expanded?: boolean) => {
    setTree(current => setExpanded(current, path, expanded ?? !current.expanded.includes(path)))
  }, [])

  return {tree, toggle, reload, loadDirectory: load}
}
