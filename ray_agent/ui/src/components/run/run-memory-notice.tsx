import {useEffect, useState} from 'react'
import {memoryApi} from '@/lib/api/memory'
import {Link} from '@/lib/navigation'
import {workspaceBackgroundHref} from '@/lib/workspace-route'
import {Bookmark, Sparkles} from '@/components/ui/icons'
import type {MemoryExtractionView} from '@/lib/api/types'

export function RunMemoryNotice({workspaceId, sessionId, sequence, follow}: {
  workspaceId: string; sessionId: string; sequence: number; follow: boolean
}) {
  const [result, setResult] = useState<MemoryExtractionView | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let remaining = follow ? 12 : 0
    const inspect = async () => {
      try {
        const next = await memoryApi.extraction(workspaceId, sessionId, sequence)
        if (cancelled) return
        setResult(next)
        if (next.status === 'pending' && remaining-- > 0) timer = setTimeout(() => void inspect(), 2500)
      } catch {
        if (!cancelled && remaining-- > 0) timer = setTimeout(() => void inspect(), 2500)
      }
    }
    void inspect()
    return () => {cancelled = true; clearTimeout(timer)}
  }, [follow, sequence, sessionId, workspaceId])

  if (result?.status !== 'committed' || !result.memories.length) return null
  const active = result.memories.filter(item => item.status === 'active')
  const candidates = result.memories.filter(item => item.status === 'candidate')
  const background = workspaceBackgroundHref(workspaceId)

  return <div className="flex flex-wrap items-center gap-2">
    {active.length > 0 && <Link href={`${background}#memory-${active[0].id}`} className="home-shortcut"><Bookmark/>记住了 {active.length} 条</Link>}
    {candidates.length > 0 && <Link href={`${background}#memory-${candidates[0].id}`} className="home-shortcut text-state-waiting"><Sparkles/>{candidates.length} 条记忆待确认</Link>}
  </div>
}
