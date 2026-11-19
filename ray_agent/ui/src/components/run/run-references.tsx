import {useEffect, useId, useState, type ReactNode} from 'react'
import {ChevronRight, Quote, Loader2, Layers, Pin, Search} from '@/components/ui/icons'
import {Link} from '@/lib/navigation'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {memoryApi} from '@/lib/api/memory'
import type {ContextManifestView, KnowledgeReference} from '@/lib/api/types'
import type {DocumentLocator} from '@/lib/api/documents'
import {sourceLocation} from '@/lib/document-location'
import {referenceKey} from '@/lib/drafts'
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
type RunReferencesProps = {runId: string; workspaceId?: string; memoryNotice?: ReactNode; actions?: ReactNode; metrics?: ReactNode
  sourceRefresh?: number; onOpenSource?: (ref: KnowledgeReference) => void}

export function RunReferences(props: RunReferencesProps) {
  return <RunReferencesContent key={props.runId} {...props}/>
}

function RunReferencesContent({runId, workspaceId, memoryNotice, actions, metrics, onOpenSource, sourceRefresh}: RunReferencesProps) {
  const detailsId = useId()
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const key = `${sourceRefresh ?? 0}:${attempt}`
  const [received, setReceived] = useState<{key: string; manifest?: ContextManifestView; error?: string}>()
  const manifest = received?.key === key ? received.manifest : undefined
  const error = received?.key === key ? received.error : undefined
  const [memoryOpen, setMemoryOpen] = useState<string | null>(null)
  const loading = attempt > 0 && !manifest && !error

  useEffect(() => {
    if (!open || attempt === 0 || received?.key === key) return
    let cancelled = false
    void memoryApi.contextManifest(runId)
      .then(data => {if (!cancelled) setReceived({key, manifest: data})})
      .catch(reason => {if (!cancelled) setReceived({key, error: reason instanceof Error ? reason.message : '读取失败'})})
    return () => {cancelled = true}
  }, [attempt, key, open, received?.key, runId])

  return (
    <div className="text-meta">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => {if (!attempt) setAttempt(1); setOpen(value => !value)}}
        className="reply-foot-action"
      >
        <Quote className="size-3.5 shrink-0" aria-hidden/>
        <span>本次参考</span>
      </button>
      {memoryNotice}
      {actions}
      {metrics && <div className="ml-auto min-w-0">{metrics}</div>}
      </div>
      {open && (
        <div id={detailsId} className="mt-1 rounded-xl border bg-muted/40 p-3">
          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden/>正在读取
            </p>
          )}
          {error && <p role="alert" className="text-state-failed">{error} <Button size="xs" variant="ghost" onClick={() => {
            setAttempt(value => value + 1)
          }}>重试</Button></p>}
          {manifest && (
            <div className="reference-grid grid gap-3">
              {(manifest.instruction_body?.trim() ?? '') !== '' && (
                <section className="space-y-1">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Layers className="size-3.5" aria-hidden/>工作方式</h4>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronRight className="size-3.5 shrink-0 text-faint group-open:rotate-90" aria-hidden/>
                      <span className="flex-1">采用版本</span>
                      {manifest.instruction_version != null && <span className="tabular-nums text-faint">v{manifest.instruction_version}</span>}
                    </summary>
                    <p className="px-2 py-1 whitespace-pre-wrap wrap-anywhere text-muted-foreground">{manifest.instruction_body}</p>
                  </details>
                </section>
              )}
              {manifest.resident_memories.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Pin className="size-3.5" aria-hidden/>常驻记忆 <span className="tabular-nums text-faint">{manifest.resident_memories.length}</span></h4>
                  <ul className="space-y-1">
                    {manifest.resident_memories.map(item => (
                      <li key={item.memory_id} className="min-w-0">
                        <button type="button" aria-expanded={memoryOpen === item.memory_id}
                          className="group flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setMemoryOpen(current => current === item.memory_id ? null : item.memory_id)}>
                          <ChevronRight className="size-3.5 shrink-0 text-faint group-aria-expanded:rotate-90" aria-hidden/>
                          <span className="min-w-0 flex-1 truncate">{item.content}</span><span className="tabular-nums text-faint">v{item.version}</span>
                        </button>
                        {memoryOpen === item.memory_id && <p className="px-2 py-1 whitespace-pre-wrap text-muted-foreground">
                          <span className="text-faint">{MEMORY_TYPE[item.memory_type] ?? item.memory_type} · </span>{item.content}
                        </p>}
                        {workspaceId && memoryOpen === item.memory_id && <MemorySources workspaceId={workspaceId} memoryId={item.memory_id} memoryVersion={item.version}/>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {([{label: '引用材料', hits: manifest.explicit_hits ?? []},
                 {label: '检索命中', hits: manifest.retrieval_hits},
                 {label: '已从后续请求移除', hits: manifest.inactive_document_hits ?? []}]).filter(section => section.hits.length > 0).map(section => (
                <section key={section.label} className="space-y-1.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Search className="size-3.5"/>{section.label}</h4>
                  <ul className="space-y-1">
                    {section.hits.map(hit => {
                      const seq = hit.payload.source_seq
                      const source = workspaceId && hit.source_type === 'session_summary' &&
                        manifest.readable_summary_sources?.includes(hit.source_id)
                        ? `${workspaceSessionHref(workspaceId, hit.source_id)}${typeof seq === 'number' && seq > 0 ? `#event-${seq}` : ''}`
                        : null
                      return (
                        <li key={referenceKey(hit)} className="rounded-md border px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
                            <span>{sourceLabel(hit.source_type)}</span>
                            {typeof hit.payload?.relative_path === 'string' && (
                              <span className="font-mono">{hit.payload.relative_path as string}</span>
                            )}
                            <span className="tabular-nums">v{hit.source_version}</span>
                            {hit.stale && <span className="text-state-waiting">历史版本</span>}
                            {hit.source_type === 'document_chunk' && sourceLocation(hit.payload.locator as DocumentLocator | undefined)}
                          </div>
                          <p className="mt-0.5 font-medium text-foreground">{hit.title || hit.snippet.slice(0, 80)}</p>
                          {hit.title && hit.snippet && <p className="mt-0.5 text-muted-foreground">{hit.snippet}</p>}
                          {hit.source_type === 'document_chunk' && (typeof hit.payload.unreadable_reason === 'string'
                            ? <p className="text-state-waiting">{hit.payload.unreadable_reason}</p>
                            : onOpenSource && <Button variant="ghost" size="xs" onClick={() => onOpenSource(hit)}>
                              {hit.stale ? '查看历史片段' : '打开原文'}
                            </Button>)}
                          {hit.source_type === 'session_summary' && (source
                            ? <Link className="reply-foot-action" href={source}>来源对话</Link>
                            : <p className="text-faint">来源对话已不可读</p>)}
                          {workspaceId && hit.source_type === 'memory' && <>
                            <Button variant="ghost" size="xs" aria-expanded={memoryOpen === `hit:${hit.source_id}`}
                              onClick={() => setMemoryOpen(current => current === `hit:${hit.source_id}` ? null : `hit:${hit.source_id}`)}>查看记忆来源</Button>
                            {memoryOpen === `hit:${hit.source_id}` && <MemorySources workspaceId={workspaceId}
                              memoryId={hit.source_id} memoryVersion={hit.source_version}/>}
                          </>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
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
                && !manifest.explicit_hits?.length
                && !manifest.inactive_document_hits?.length
                && manifest.omissions.length === 0 && (
                <p className="text-muted-foreground">这次运行没有附加工作区背景。</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
