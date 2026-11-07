import {useEffect, useState} from 'react'
import {ChevronRight, Loader2} from 'lucide-react'
import {memoryApi} from '@/lib/api/memory'
import type {ContextManifestView} from '@/lib/api/types'
import {cn} from '@/lib/utils'

const MEMORY_TYPE: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决定',
  constraint: '约束',
}

function sourceLabel(type: string) {
  if (type === 'memory') return '记忆'
  if (type === 'session_summary') return '对话摘要'
  if (type === 'document_chunk') return '文件'
  return type
}

/** 助手最终回复下方：展开查看该次运行注入的工作方式、常驻记忆与初始召回。 */
export function RunReferences({runId}: {runId: string}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [manifest, setManifest] = useState<ContextManifestView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setManifest(null)
    setError(null)
  }, [runId])

  useEffect(() => {
    if (!open || manifest || loading) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void memoryApi.contextManifest(runId)
      .then(data => {if (!cancelled) setManifest(data)})
      .catch(err => {if (!cancelled) setError(err instanceof Error ? err.message : '读取失败')})
      .finally(() => {if (!cancelled) setLoading(false)})
    return () => {cancelled = true}
  }, [open, manifest, loading, runId])

  return (
    <div className="text-meta">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-8 w-full items-center gap-1 rounded-md px-1 text-left text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden/>
        <span>本次参考</span>
      </button>
      {open && (
        <div className="ml-5 space-y-3 border-l border-border pl-3 py-2">
          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden/>正在读取
            </p>
          )}
          {error && <p className="text-state-failed">{error}</p>}
          {manifest && (
            <>
              {(manifest.instruction_body?.trim() ?? '') !== '' && (
                <section className="space-y-1">
                  <h4 className="text-xs font-medium text-foreground">工作方式</h4>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">{manifest.instruction_body}</p>
                </section>
              )}
              {manifest.resident_memories.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">常驻记忆</h4>
                  <ul className="space-y-1">
                    {manifest.resident_memories.map(item => (
                      <li key={item.memory_id} className="rounded-md bg-muted/40 px-2 py-1.5 text-muted-foreground">
                        <span className="text-faint">{MEMORY_TYPE[item.memory_type] ?? item.memory_type} · </span>
                        {item.content}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {manifest.retrieval_hits.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">初始召回</h4>
                  <ul className="space-y-1">
                    {manifest.retrieval_hits.map(hit => (
                      <li key={`${hit.source_type}:${hit.source_id}`} className="rounded-md border px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
                          <span>{sourceLabel(hit.source_type)}</span>
                          {typeof hit.payload?.relative_path === 'string' && (
                            <span className="font-mono">{hit.payload.relative_path as string}</span>
                          )}
                          {hit.stale && <span className="text-state-waiting">已过期</span>}
                        </div>
                        <p className="mt-0.5 font-medium text-foreground">{hit.title || hit.snippet.slice(0, 80)}</p>
                        {hit.title && <p className="mt-0.5 text-muted-foreground">{hit.snippet}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {manifest.omissions.length > 0 && (
                <section className="space-y-1">
                  <h4 className="text-xs font-medium text-foreground">未采用</h4>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {manifest.omissions.map((item, index) => (
                      <li key={`${item.kind}-${index}`}>{item.reason}</li>
                    ))}
                  </ul>
                </section>
              )}
              {!manifest.instruction_body?.trim()
                && manifest.resident_memories.length === 0
                && manifest.retrieval_hits.length === 0
                && manifest.omissions.length === 0 && (
                <p className="text-muted-foreground">这次运行没有附加工作区背景。</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
