import {useEffect, useState} from 'react'
import {ChevronRight, Loader2, FileText, Layers, Search} from '@/components/ui/icons'
import {memoryApi} from '@/lib/api/memory'
import type {ContextManifestView} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {MemorySources} from '@/components/workspace/memory-sources'

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
export function RunReferences({runId, workspaceId}: {runId: string; workspaceId?: string}) {
  return <RunReferencesContent key={runId} runId={runId} workspaceId={workspaceId}/>
}

function RunReferencesContent({runId, workspaceId}: {runId: string; workspaceId?: string}) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [manifest, setManifest] = useState<ContextManifestView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [memoryOpen, setMemoryOpen] = useState<string | null>(null)
  const loading = attempt > 0 && manifest === null && error === null

  useEffect(() => {
    if (attempt === 0) return
    let cancelled = false
    void memoryApi.contextManifest(runId)
      .then(data => {if (!cancelled) setManifest(data)})
      .catch(reason => {if (!cancelled) setError(reason instanceof Error ? reason.message : '读取失败')})
    return () => {cancelled = true}
  }, [attempt, runId])

  return (
    <div className="text-meta">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {if (!attempt) setAttempt(1); setOpen(value => !value)}}
        className="flex min-h-8 w-full items-center gap-1 rounded-md px-1 text-left text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden/>
        <span>本次参考</span>
      </button>
      {open && (
        <div className="mt-1 space-y-3 rounded-xl bg-muted/60 p-3">
          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden/>正在读取
            </p>
          )}
          {error && <p role="alert" className="text-state-failed">{error} <Button size="xs" variant="ghost" onClick={() => {
            setError(null); setAttempt(value => value + 1)
          }}>重试</Button></p>}
          {manifest && (
            <>
              {(manifest.instruction_body?.trim() ?? '') !== '' && (
                <section className="space-y-1">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><FileText className="size-3.5"/>工作方式 {manifest.instruction_version != null && <span className="text-faint">v{manifest.instruction_version}</span>}</h4>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">{manifest.instruction_body}</p>
                </section>
              )}
              {manifest.resident_memories.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Layers className="size-3.5"/>常驻记忆</h4>
                  <ul className="space-y-1">
                    {manifest.resident_memories.map(item => (
                      <li key={item.memory_id} className="rounded-md bg-muted/40 px-2 py-1.5 text-muted-foreground">
                        <span className="text-faint">{MEMORY_TYPE[item.memory_type] ?? item.memory_type} · </span>
                        {item.content} <span className="text-faint">v{item.version}</span>
                        {workspaceId && <Button size="xs" variant="ghost" aria-expanded={memoryOpen === item.memory_id}
                          onClick={() => setMemoryOpen(current => current === item.memory_id ? null : item.memory_id)}>看来源</Button>}
                        {workspaceId && memoryOpen === item.memory_id && <MemorySources workspaceId={workspaceId} memoryId={item.memory_id} memoryVersion={item.version}/>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {manifest.retrieval_hits.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Search className="size-3.5"/>检索命中</h4>
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
