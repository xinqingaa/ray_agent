import {useEffect, useState} from 'react'
import {memoryApi} from '@/lib/api/memory'
import {Link} from '@/lib/navigation'
import {workspaceBackgroundHref} from '@/lib/workspace-route'
import {Bookmark, Sparkles} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {ApiError} from '@/lib/api/fetch'
import type {MemoryExtractionView, MemoryItem} from '@/lib/api/types'
import {toast} from 'sonner'

export function RunMemoryNotice({workspaceId, sessionId, sequence, follow, readOnly}: {
  workspaceId: string; sessionId: string; sequence: number; follow: boolean; readOnly: boolean
}) {
  const [result, setResult] = useState<MemoryExtractionView | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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
  const replaceMemory = (next: MemoryItem) => setResult(current => current && ({
    ...current, memories: current.memories.map(item => item.id === next.id ? next : item),
  }))
  const retract = async (item: MemoryItem) => {
    if (readOnly || busy) return
    setBusy(item.id)
    try {
      const next = await memoryApi.patch(workspaceId, item.id, {action: 'retract', version: item.version})
      replaceMemory(next)
      toast.success('已撤回记忆', {action: {label: '撤销', onClick: () => {
        void memoryApi.patch(workspaceId, next.id, {action: 'undo', version: next.version})
          .then(replaceMemory)
          .catch(error => toast.error(error instanceof Error ? error.message : '撤销失败'))
      }}})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤回失败')
      if (error instanceof ApiError && error.code === 'conflict') {
        await memoryApi.extraction(workspaceId, sessionId, sequence).then(setResult).catch(() => {})
      }
    } finally {
      setBusy(null)
    }
  }

  return <>
    {(active.length > 0 || open) && <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="reply-foot-action">
        <Bookmark aria-hidden/>{active.length > 0 ? `记住了 ${active.length} 条` : '已撤回记忆'}
      </button></PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} aria-label="这次记住了"
        className="w-[min(21.25rem,calc(100vw-1.5rem))] gap-0 rounded-xl p-3 shadow-(--float-shadow)">
        <h4 className="flex items-center gap-2 text-sm font-medium"><Bookmark className="size-4 text-muted-foreground" aria-hidden/>这次记住了</h4>
        {active.length ? <ul className="mt-2 max-h-56 divide-y overflow-y-auto overscroll-contain">
          {active.map(item => <li key={item.id} className="flex items-start gap-2 py-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">{item.content}</p>
            {!readOnly && <Button type="button" variant="ghost" size="xs" disabled={busy !== null} onClick={() => void retract(item)}>
              {busy === item.id ? '撤回中' : '撤回'}
            </Button>}
          </li>)}
        </ul> : <p role="status" className="my-2 text-xs text-muted-foreground">这次记住的条目已撤回。</p>}
        <Link href={active.length ? `${background}#memory-${active[0].id}` : background} className="reply-foot-action mt-1">在背景中查看</Link>
      </PopoverContent>
    </Popover>}
    {candidates.length > 0 && <Link href={`${background}#memory-${candidates[0].id}`} className="reply-foot-action text-state-waiting">
      <Sparkles aria-hidden/>{candidates.length} 条记忆待确认
    </Link>}
  </>
}
