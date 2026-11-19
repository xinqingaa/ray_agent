import {useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {ChevronRight, Loader2, PanelRight, Quote} from '@/components/ui/icons'
import {Link} from '@/lib/navigation'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {memoryApi} from '@/lib/api/memory'
import type {ContextManifestView, KnowledgeReference, SearchHitView} from '@/lib/api/types'
import type {DocumentLocator} from '@/lib/api/documents'
import {sourceLocation} from '@/lib/document-location'
import {citationIdentifiers, resolveRunCitations} from '@/lib/run-citations'
import {referenceKey} from '@/lib/drafts'
import {MEMORY_TYPE_LABEL} from '@/lib/memory-labels'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {useKnowledgeSource} from '@/components/workspace/knowledge-source'
import {MemorySources} from '@/components/workspace/memory-sources'

function ReferenceMemorySource({workspaceId, memoryId, version}: {workspaceId: string; memoryId: string; version: number}) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className="run-context-source" aria-label="查看记忆来源">来源</button></PopoverTrigger>
    <PopoverContent aria-label="记忆来源" className="w-[min(20rem,calc(100vw-1.5rem))] p-3">
      {open && <MemorySources workspaceId={workspaceId} memoryId={memoryId} memoryVersion={version}/>}
    </PopoverContent>
  </Popover>
}

type DocumentReferenceProps = {
  reference: KnowledgeReference; number?: number; hit?: SearchHitView; removed?: boolean
  onOpenSource?: (ref: KnowledgeReference) => void
}

function DocumentReference({reference, number, hit, removed, onOpenSource, name, location, excerpt, historical, unavailable, feedback}: DocumentReferenceProps & {
  name?: string; location?: string; excerpt?: string; historical?: boolean; unavailable?: string; feedback?: ReactNode
}) {
  const path = hit?.payload.relative_path
  const filename = name || (typeof path === 'string' && path.split('/').at(-1)) || hit?.title || '文件来源'
  const locator = location ?? sourceLocation(hit?.payload.locator as DocumentLocator | undefined)
  const metadata = [locator, `v${reference.source_version}`].filter(Boolean).join(' · ')
  const snippet = excerpt ?? hit?.snippet
  const unreadable = unavailable ?? (typeof hit?.payload.unreadable_reason === 'string' ? hit.payload.unreadable_reason : undefined)
  const stale = historical ?? hit?.stale

  return <li className="run-document-reference" data-numbered={number != null}>
    {number != null && <span className="reply-citation-number run-document-number" aria-label={`引用 ${number}`}>{number}</span>}
    <div className="run-document-body">
      <div className="run-document-heading">
        {onOpenSource && !unreadable ? <button type="button" className="run-document-name run-document-link"
          aria-label={stale ? `查看历史片段，${filename}，${metadata}` : `在右侧查看 ${filename}，${metadata}`}
          title={stale ? '查看历史片段' : '在右侧查看'} onClick={() => onOpenSource(reference)}>
          <span>{filename}</span><PanelRight aria-hidden/>
        </button> : <p className="run-document-name">{filename}</p>}
        <p className="run-document-meta">
          <span>{metadata}</span>
          {stale && <span className="text-state-waiting">历史版本</span>}
          {removed && <span className="text-state-waiting">运行中移除</span>}
          {unreadable && <span className="text-state-waiting">不可读</span>}
        </p>
      </div>
      {unreadable ? <p className="mt-1 text-xs text-state-waiting">{unreadable}</p>
        : snippet?.trim() && <p className="run-document-excerpt">{snippet}</p>}
      {feedback}
    </div>
  </li>
}

/** 工具返回的引用可能只有身份，没有随运行装配保存的摘录。 */
function ResolvedDocumentReference({workspaceId, sourceRefresh, ...props}: DocumentReferenceProps & {
  workspaceId: string; sourceRefresh?: number
}) {
  const {state, retry} = useKnowledgeSource(workspaceId, props.reference, true, sourceRefresh)
  const source = state && 'value' in state && state.value.kind === 'document' ? state.value.data : null
  return <DocumentReference {...props}
    name={source?.relative_path.split('/').at(-1)} location={source ? sourceLocation(source.locator) : undefined}
    excerpt={source?.body} historical={source?.stale}
    unavailable={state && 'error' in state && state.unavailable ? state.error : undefined}
    feedback={!state ? <p role="status" className="mt-1 text-xs text-muted-foreground">正在读取来源…</p>
      : 'error' in state && !state.unavailable && <div className="mt-1 text-xs text-state-failed">
        {state.error}<Button type="button" variant="ghost" size="xs" onClick={retry}>重试</Button>
      </div>}/>
}

function ContextHit({hit, workspaceId, readableSummaries, onOpenSource}: {
  hit: SearchHitView; workspaceId?: string; readableSummaries?: string[]; onOpenSource?: (ref: KnowledgeReference) => void
}) {
  if (hit.source_type === 'document_chunk') return <DocumentReference reference={hit} hit={hit} onOpenSource={onOpenSource}/>
  const summary = hit.source_type === 'session_summary'
  const seq = hit.payload.source_seq
  const source = workspaceId && summary && readableSummaries?.includes(hit.source_id)
    ? `${workspaceSessionHref(workspaceId, hit.source_id)}${typeof seq === 'number' && seq > 0 ? `#event-${seq}` : ''}` : null
  const memoryType = MEMORY_TYPE_LABEL[hit.title as keyof typeof MEMORY_TYPE_LABEL]
  return <li className="run-context-entry">
    <p className="whitespace-pre-wrap">{hit.snippet || hit.title}</p>
    <div className="run-context-row-meta">
      <span className="run-context-meta">{summary ? '对话摘要' : memoryType || '记忆'} · v{hit.source_version}</span>
      {summary && (source ? <Link className="run-context-source" href={source}>来源对话</Link>
        : <span className="run-context-meta">来源对话已不可读</span>)}
      {!summary && workspaceId && <ReferenceMemorySource workspaceId={workspaceId} memoryId={hit.source_id} version={hit.source_version}/>}
    </div>
  </li>
}

function ReferenceContents({manifest, replyText, workspaceId, sourceRefresh, onOpenSource, onRead}: {
  manifest: ContextManifestView; replyText: string; workspaceId?: string; sourceRefresh?: number
  onOpenSource?: (ref: KnowledgeReference) => void; onRead?: (trigger: HTMLButtonElement, open: boolean) => void
}) {
  const detailsId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsVisited, setDetailsVisited] = useState(false)
  const citations = resolveRunCitations(citationIdentifiers(replyText), manifest.citation_sources ?? [])
  const citedKeys = new Set(citations.map(referenceKey))
  const explicit = manifest.explicit_hits ?? []
  const inactive = manifest.inactive_document_hits ?? []
  const removedKeys = new Set(inactive.map(referenceKey))
  const allHits = new Map([...manifest.retrieval_hits, ...explicit, ...inactive].map(hit => [referenceKey(hit), hit]))
  const requested = explicit.filter(hit => !citedKeys.has(referenceKey(hit)))
  const primaryKeys = new Set([...citedKeys, ...explicit.map(referenceKey)])
  const retrieved = manifest.retrieval_hits.filter(hit => !primaryKeys.has(referenceKey(hit)))
  const removed = inactive.filter(hit => !primaryKeys.has(referenceKey(hit)))
  const instruction = manifest.instruction_body?.trim()
  const residents = manifest.resident_memories
  const omissions = manifest.omissions
  const contextSummary = [
    manifest.instruction_version != null ? `工作方式 v${manifest.instruction_version}` : instruction ? '工作方式' : '',
    residents.length ? `常驻记忆 ${residents.length} 条` : '',
    retrieved.length ? `检索命中 ${retrieved.length} 条` : '',
  ].filter(Boolean).join(' · ')
  const summary = contextSummary || [removed.length ? `运行中移除 ${removed.length} 条` : '',
    omissions.length ? `未采用 ${omissions.length} 条` : ''].filter(Boolean).join(' · ')
  const renderHit = (hit: SearchHitView) => <ContextHit key={referenceKey(hit)} hit={hit} workspaceId={workspaceId}
    readableSummaries={manifest.readable_summary_sources} onOpenSource={onOpenSource}/>

  return <>
    {citations.length > 0 && <section className="run-reference-primary">
      <h4>正文引用{citations.length > 1 && <span> · {citations.length} 处</span>}</h4>
      <ul aria-label="正文引用" className="run-primary-list" data-run-primary-scroll={citations.length > 3 ? '' : undefined} tabIndex={citations.length > 3 ? 0 : undefined}>
        {citations.map((reference, index) => {
          const key = referenceKey(reference)
          const hit = allHits.get(key)
          const props = {reference, number: index + 1, hit, removed: removedKeys.has(key), onOpenSource}
          return workspaceId && !hit?.snippet?.trim() && typeof hit?.payload.unreadable_reason !== 'string'
            ? <ResolvedDocumentReference key={key} {...props} workspaceId={workspaceId} sourceRefresh={sourceRefresh}/>
            : <DocumentReference key={key} {...props}/>
        })}
      </ul>
    </section>}
    {requested.length > 0 && <section className="run-reference-primary">
      <h4>你指定的材料</h4>
      <ul aria-label="你指定的材料" className="run-primary-list" data-run-primary-scroll={requested.length > 3 ? '' : undefined} tabIndex={requested.length > 3 ? 0 : undefined}>
        {requested.map(hit => <DocumentReference key={referenceKey(hit)} reference={hit} hit={hit}
          removed={removedKeys.has(referenceKey(hit))} onOpenSource={onOpenSource}/>)}
      </ul>
    </section>}
    {summary && <div className="run-reference-context">
      <button type="button" id={`${detailsId}-trigger`} className="run-context-trigger"
        aria-expanded={detailsOpen} aria-controls={detailsId} onClick={event => {
          const next = !detailsOpen
          onRead?.(event.currentTarget, next)
          setDetailsVisited(true)
          setDetailsOpen(next)
        }}>
        <span className="run-context-trigger-label">
          <span className="run-context-trigger-title">运行详情</span>
          <span className="run-context-meta">{summary}</span>
        </span>
        <ChevronRight aria-hidden/>
      </button>
      <div id={detailsId} className="run-context-reveal" data-open={detailsOpen} aria-hidden={!detailsOpen} inert={!detailsOpen}>
        <div className="run-reference-clip">
          {detailsVisited && <div data-run-context-scroll className="run-context-content" role="region" aria-label="运行详情内容" tabIndex={0}>
            {(instruction || manifest.instruction_version != null) && <section>
              <h4>工作方式{manifest.instruction_version != null && ` v${manifest.instruction_version}`}</h4>
              <p className="run-context-entry whitespace-pre-wrap">{instruction || '该版本没有正文。'}</p>
            </section>}
            {residents.length > 0 && <section>
              <h4>常驻记忆</h4>
              <ul>{residents.map(item => <li key={item.memory_id} className="run-context-entry">
                <p className="whitespace-pre-wrap">{item.content}</p>
                <div className="run-context-row-meta">
                  <span className="run-context-meta">
                    {MEMORY_TYPE_LABEL[item.memory_type as keyof typeof MEMORY_TYPE_LABEL] ?? item.memory_type} · v{item.version}{item.pinned ? ' · 钉住' : ''}
                  </span>
                  {workspaceId && <ReferenceMemorySource workspaceId={workspaceId} memoryId={item.memory_id} version={item.version}/>}
                </div>
              </li>)}</ul>
            </section>}
            {retrieved.length > 0 && <section><h4>其他检索命中</h4><ul>{retrieved.map(renderHit)}</ul></section>}
            {removed.length > 0 && <section><h4>运行中移除</h4><ul>{removed.map(renderHit)}</ul></section>}
            {omissions.length > 0 && <section><h4>未采用</h4><ul className="run-context-meta">
              {omissions.map((item, index) => <li className="run-context-entry" key={`${item.kind}-${index}`}>{item.reason}</li>)}
            </ul></section>}
          </div>}
        </div>
      </div>
    </div>}
    {!summary && !citations.length && !requested.length && <p className="text-muted-foreground">这次回复没有记录引用或工作区背景。</p>}
  </>
}

/** 展示这次运行实际采用的版本和材料。 */
type RunReferencesProps = {
  runId: string; replyText: string; workspaceId?: string; memoryNotice?: ReactNode; actions?: ReactNode; metrics?: ReactNode
  sourceRefresh?: number; onOpenSource?: (ref: KnowledgeReference) => void
  onToggle?: (trigger: HTMLButtonElement, open: boolean, settled?: boolean) => void
}

export function RunReferences(props: RunReferencesProps) {
  return <RunReferencesContent key={props.runId} {...props}/>
}

function RunReferencesContent({runId, replyText, workspaceId, memoryNotice, actions, metrics, onOpenSource, sourceRefresh, onToggle}: RunReferencesProps) {
  const detailsId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const key = `${sourceRefresh ?? 0}:${attempt}`
  const [received, setReceived] = useState<{key: string; manifest?: ContextManifestView; error?: string}>()
  const manifest = received?.key === key ? received.manifest : undefined
  const error = received?.key === key ? received.error : undefined
  const loading = attempt > 0 && !manifest && !error

  useEffect(() => {
    if (!open || attempt === 0 || received?.key === key) return
    let cancelled = false
    void memoryApi.contextManifest(runId)
      .then(data => {if (!cancelled) setReceived({key, manifest: data})})
      .catch(reason => {if (!cancelled) setReceived({key, error: reason instanceof Error ? reason.message : '读取失败'})})
    return () => {cancelled = true}
  }, [attempt, key, open, received?.key, runId])

  const toggle = (next: boolean) => {
    if (trigger.current) onToggle?.(trigger.current, next)
    if (!attempt) setAttempt(1)
    setOpen(next)
  }

  return <div className="text-meta">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2" data-run-reference-toolbar>
      <button ref={trigger} id={`${detailsId}-trigger`} type="button" aria-expanded={open} aria-controls={detailsId}
        onClick={() => toggle(!open)} className="reply-foot-action group">
        <Quote aria-hidden/><span>本次参考</span>
        <ChevronRight className="motion-safe:transition-transform group-aria-expanded:rotate-90" aria-hidden/>
      </button>
      {memoryNotice}
      {actions}
      {metrics && <div className="ml-auto min-w-0">{metrics}</div>}
    </div>
    <div id={detailsId} role="region" aria-labelledby={`${detailsId}-trigger`} aria-hidden={!open} inert={!open}
      data-open={open} className="run-reference-reveal" onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && open && trigger.current) {
          onToggle?.(trigger.current, true, true)
        }
      }} onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.stopPropagation()
        trigger.current?.focus({preventScroll: true})
        toggle(false)
      }}>
      <div className="run-reference-clip">
        {attempt > 0 && <div className="run-reference-paper">
          {loading && <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden/>正在读取
          </p>}
          {error && <p role="alert" className="text-state-failed">{error} <Button type="button" size="xs" variant="ghost"
            onClick={() => setAttempt(value => value + 1)}>重试</Button></p>}
          {manifest && <ReferenceContents manifest={manifest} replyText={replyText} workspaceId={workspaceId}
            sourceRefresh={sourceRefresh} onOpenSource={onOpenSource} onRead={onToggle}/>}
        </div>}
      </div>
    </div>
  </div>
}
