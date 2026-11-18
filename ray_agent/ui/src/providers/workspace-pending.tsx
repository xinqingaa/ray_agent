import {createContext, useCallback, useContext, useEffect, useState, type ReactNode} from 'react'
import {instructionApi} from '@/lib/api/instruction'
import {memoryApi} from '@/lib/api/memory'

const WorkspacePendingContext = createContext<{
  count: number | null
  report: (count: number) => void
}>({count: null, report: () => undefined})

/** 背景页上报其已经读到的数据，其他工作区视图只读取待处理条目。 */
export function WorkspacePendingProvider({workspaceId, background, children}: {
  workspaceId: string | null
  background: boolean
  children: ReactNode
}) {
  const [snapshot, setSnapshot] = useState<{id: string; count: number} | null>(null)
  const report = useCallback((count: number) => {
    if (workspaceId) setSnapshot(current => current?.id === workspaceId && current.count === count ? current : {id: workspaceId, count})
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || background) return
    let active = true
    void Promise.all([instructionApi.proposals(workspaceId, 'pending'), memoryApi.list(workspaceId, ['candidate'])])
      .then(([proposals, memories]) => {if (active) report(proposals.length + memories.memories.length)})
      .catch(() => {if (active) setSnapshot(current => current?.id === workspaceId ? null : current)})
    return () => {active = false}
  }, [background, workspaceId, report])

  const count = snapshot && snapshot.id === workspaceId ? snapshot.count : null
  return <WorkspacePendingContext.Provider value={{count, report}}>{children}</WorkspacePendingContext.Provider>
}

export function useWorkspacePending() {
  return useContext(WorkspacePendingContext)
}
