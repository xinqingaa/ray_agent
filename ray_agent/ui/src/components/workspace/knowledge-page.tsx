import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useLocation, useNavigate, useOutletContext, useSearchParams} from 'react-router'
import {toast} from 'sonner'
import {Bookmark, Check, Folder, FolderOpen, Layers, Loader2, RefreshCw, Search, X} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {fileExtension, FileTypeBadge} from '@/components/run/file-icon'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {WorkspaceSwitch} from './workspace-switch'
import {HitText, KnowledgeSource, SOURCE_ICON, SOURCE_LABEL, sourceCaption, sourceTitle} from './knowledge-source'
import {documentsApi, type DocumentItem, type IndexPolicy, type IndexSummary} from '@/lib/api/documents'
import type {RootSource} from '@/lib/api/preview'
import {componentsApi, type ComponentView} from '@/lib/api/components'
import {ApiError} from '@/lib/api/fetch'
import {memoryApi} from '@/lib/api/memory'
import {operationApi} from '@/lib/api/workspace'
import type {OperationView, SearchHitView, SearchResponse, WorkspaceItem} from '@/lib/api/types'
import {addDraftReference, referenceKey, workspaceDraftScope, type DraftReference} from '@/lib/drafts'
import {Link} from '@/lib/navigation'
import {motionEasing} from '@/lib/motion'
import {cn, formatFileSize} from '@/lib/utils'
import {workspaceHref} from '@/lib/workspace-route'
import {useWorkspaceLive} from '@/providers/workspace-live-provider'
import './knowledge-page.css'

const VIEW_OPTIONS = [{value: 'search', label: '检索', icon: Search}, {value: 'index', label: '索引', icon: Layers}] as const
const FILTERS = ['all', 'document_chunk', 'memory', 'session_summary'] as const
type Filter = typeof FILTERS[number]
type SearchState = {revision: string; hits?: SearchHitView[]; execution?: SearchResponse['execution']; error?: string}
const EMPTY_HITS: SearchHitView[] = []

const STATUS = {
  registered: '等待扫描', pending_parse: '等待解析', parsing: '解析中', indexing: '建立索引',
  pending_component: '待文字识别', searchable: '可检索', failed: '失败', withdrawn: '已撤回', excluded: '已排除',
} satisfies Record<DocumentItem['status'], string>

function errorText(reason: unknown, fallback = '读取失败') {
  return reason instanceof Error ? reason.message : fallback
}

const SEMANTIC_LABEL = {
  not_installed: '语义未安装', empty: '暂无语义材料', pending: '语义待索引',
  queued: '语义已排队', running: '语义索引中', ready: '语义可用',
  paused: '语义已暂停', blocked: '语义等待索引条件', failed: '语义索引异常',
} satisfies Record<IndexSummary['semantic']['state'], string>

function installHref(component: 'ocr' | 'embedding-e5', returnTo: string) {
  return `/components?${new URLSearchParams({component, return: returnTo})}`
}

function ComponentAvailability({items, summary, error, onRetry, returnTo}: {
  items: ComponentView[] | null; summary: IndexSummary | null; error: string | null;
  onRetry: () => void; returnTo: string
}) {
  const embedding = items?.find(item => item.component_id === 'embedding-e5')
  const ocr = items?.find(item => item.component_id === 'ocr')
  const semantic = summary?.semantic
  const installing = (item: ComponentView | undefined) => item?.state === 'fetching' || item?.state === 'verifying'
  const ocrReady = ocr?.state === 'available'
  const ocrLabel = ocrReady ? '文字识别可用' : installing(ocr) ? '文字识别安装中' : ocr ? '文字识别未就绪' : '文字识别 · —'
  const semanticLabel = installing(embedding) ? '语义安装中' : semantic ? SEMANTIC_LABEL[semantic.state] : '语义 · —'
  return <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
    <span className="knowledge-availability" data-ready="true"><Check aria-hidden/>全文</span>
    {embedding && embedding.state !== 'available'
      ? <Link className="knowledge-availability hover:underline" href={installHref('embedding-e5', returnTo)}>{semanticLabel}</Link>
      : <span className="knowledge-availability" data-ready={semantic?.state === 'ready'} title={semantic?.error ?? undefined}>{semanticLabel}</span>}
    {ocr && !ocrReady
      ? <Link className="knowledge-availability hover:underline" href={installHref('ocr', returnTo)}>{ocrLabel}</Link>
      : <span className="knowledge-availability" data-ready={ocrReady}>{ocrLabel}</span>}
    {error && <Button variant="ghost" size="xs" title={error} onClick={onRetry}>重读索引状态</Button>}
  </div>
}

export function WorkspaceKnowledgePage() {
  const workspace = useOutletContext<WorkspaceItem>()
  return <KnowledgeContent key={workspace.id} workspace={workspace}/>
}

function KnowledgeContent({workspace}: {workspace: WorkspaceItem}) {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'index' ? 'index' : 'search'
  const {pathname, search} = useLocation()
  const {change} = useWorkspaceLive()
  const [items, setItems] = useState<ComponentView[] | null>(null)
  const [summary, setSummary] = useState<IndexSummary | null>(null)
  const [componentError, setComponentError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const refresh = useCallback(() => setRetry(value => value + 1), [])
  const acceptSummary = useCallback((next: IndexSummary) => setSummary(current =>
    current && (current.policy.version > next.policy.version || current.publication_generation > next.publication_generation)
      ? current : next), [])
  const [searchRevision, setSearchRevision] = useState(0)
  useEffect(() => {
    let disposed = false
    let readId = 0
    let timer: number | undefined
    const read = async () => {
      window.clearTimeout(timer)
      const request = ++readId
      if (document.hidden) return
      const [componentResult, indexResult] = await Promise.allSettled([
        componentsApi.list(), documentsApi.summary(workspace.id),
      ])
      if (disposed || request !== readId) return
      if (componentResult.status === 'fulfilled') {
        setItems(componentResult.value)
        setComponentError(null)
      } else setComponentError(errorText(componentResult.reason))
      if (indexResult.status === 'fulfilled') {
        acceptSummary(indexResult.value)
        setSummaryError(null)
      } else setSummaryError(errorText(indexResult.reason, '无法读取索引'))
      const header = indexResult.status === 'fulfilled' ? indexResult.value : null
      const working = header?.active_operation_id || header?.semantic?.state === 'queued' || header?.semantic?.state === 'running'
        || componentResult.status === 'fulfilled' && componentResult.value.some(item => item.state === 'fetching' || item.state === 'verifying')
      if (!document.hidden) timer = window.setTimeout(() => void read(), working ? 1800 : 10000)
    }
    const refreshWhenVisible = () => void read()
    void read()
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [workspace.id, retry, change.signal, acceptSummary])
  const returnTo = pathname + search
  const publication = JSON.stringify([summary?.publication_generation, summary?.vector_generation,
    summary?.embedding_config, summary?.semantic?.published_version, summary?.semantic?.state === 'ready'])
  return <main aria-label="知识" className="workspace-detail-root">
    <div className="workspace-detail-head">
      <SegmentedControl idPrefix="knowledge-view" label="知识视图" options={VIEW_OPTIONS} value={view}
        appearance="icons" onValueChange={next => {
          if (next === 'search' && view !== 'search') setSearchRevision(value => value + 1)
          if (next === view) return
          const updated = new URLSearchParams(params)
          if (next === 'index') updated.set('view', 'index')
          else updated.delete('view')
          setParams(updated)
        }}/>
      <ComponentAvailability items={items} summary={summary} error={componentError ?? summaryError} onRetry={refresh} returnTo={returnTo}/>
    </div>
    <div id="knowledge-view-panel-search" role="tabpanel" aria-labelledby="knowledge-view-search"
      hidden={view !== 'search'} className="knowledge-view">
      <KnowledgeSearch workspace={workspace} visible={view === 'search'} revision={`${searchRevision}:${publication}`} semantic={summary?.semantic}/>
    </div>
    <div id="knowledge-view-panel-index" role="tabpanel" aria-labelledby="knowledge-view-index" hidden={view !== 'index'} className="knowledge-view">
      <IndexView workspace={workspace} visible={view === 'index'} summary={summary} summaryError={summaryError}
        refreshSummary={refresh} acceptSummary={acceptSummary} ocrAvailable={items?.some(item => item.component_id === 'ocr' && item.state === 'available') ?? false}/>
    </div>
  </main>
}

function KnowledgeSearch({workspace, visible, revision, semantic}: {
  workspace: WorkspaceItem; visible: boolean; revision: string; semantic?: IndexSummary['semantic']
}) {
  const navigate = useNavigate()
  const {change} = useWorkspaceLive()
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').slice(0, 500)
  const scope = params.get('source')
  const filter = FILTERS.find(value => value === scope) ?? 'all'
  const selection = params.get('pick')
  const [results, setResults] = useState<{query: string; scopes: Partial<Record<Filter, SearchState>>}>()
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const resultList = useRef<HTMLUListElement>(null)
  const positions = useRef<{query: string; rows: Map<string, number>} | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const queryInput = useRef<HTMLInputElement>(null)
  const clean = query.trim()
  const revisionKey = `${revision}:${change.signal}:${attempt}`
  const scoped = results?.query === clean ? results.scopes : undefined
  const hasCachedQuery = Boolean(scoped)
  const displayed = scoped?.[filter]
  const filtered = filter !== 'all' ? scoped?.all?.hits?.filter(hit => hit.source_type === filter) : undefined
  const hits = displayed?.hits ?? filtered ?? EMPTY_HITS
  const loading = displayed?.revision !== revisionKey
  const error = !loading ? displayed?.error : undefined
  const reason = !loading && !error ? displayed?.execution?.reason : undefined
  const fallback = reason === 'component_unavailable' ? '语义组件不可用，当前仅全文检索。'
    : reason === 'semantic_error' ? '本次语义检索失败，当前显示全文结果。'
    : reason === 'index_pending' && semantic?.state !== 'empty'
      ? '当前仅全文检索，语义索引尚未就绪。' : null
  const selected = hits.find(hit => referenceKey(hit) === selection) ?? hits[0]
  const canQuote = workspace.status === 'active'
  const updateSearch = (values: Record<string, string>) => {
    const updated = new URLSearchParams(params)
    for (const [name, value] of Object.entries(values)) {
      if (value) updated.set(name, value)
      else updated.delete(name)
    }
    setParams(updated, {replace: true})
  }
  const setQuery = (value: string) => {updateSearch({q: value, pick: ''}); setOpen(false)}
  const openFile = (source: RootSource) => {
    const search = new URLSearchParams(params)
    if (selected) search.set('pick', referenceKey(selected))
    void navigate(workspaceHref(workspace.id), {state: {folderPreview: source, knowledgeSearch: search.toString()}})
  }

  useEffect(() => {
    const node = list.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width) setNarrow(entry.contentRect.width < 650)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (clean || !visible) return
    let active = true
    void documentsApi.page(workspace.id, undefined, 32).then(data => {
      if (!active) return
      const names = data.items.filter(item => item.status === 'searchable').map(item => item.relative_path.split('/').at(-1) ?? '')
      setSuggestions([...new Set(names.map(name => name.slice(0, name.length - fileExtension(name).length)).filter(Boolean))].slice(0, 3))
    }, () => {})
    return () => {active = false}
  }, [clean, visible, workspace.id, change.signal, revision])

  useEffect(() => {
    if (!clean || !visible || !loading) return
    const controller = new AbortController()
    const publish = (result: SearchState) => {
      if (controller.signal.aborted) return
      setResults(current => ({query: clean, scopes: {
        ...(current?.query === clean ? current.scopes : {}),
        [filter]: {...(current?.query === clean ? current.scopes[filter] : undefined), ...result},
      }}))
    }
    const timer = window.setTimeout(() => {
      void memoryApi.search(workspace.id, {query: clean, ...(filter === 'all' ? {} : {source_types: [filter]})}, controller.signal)
        .then(response => publish({revision: revisionKey, hits: response.hits, execution: response.execution, error: undefined}),
          error => publish({revision: revisionKey, error: errorText(error, '检索失败')}))
    }, hasCachedQuery ? 0 : 180)
    return () => {window.clearTimeout(timer); controller.abort()}
  }, [clean, filter, hasCachedQuery, loading, revisionKey, visible, workspace.id])

  useLayoutEffect(() => {
    if (!visible) {positions.current = null; return}
    const previous = positions.current
    const nodes = Array.from(resultList.current?.querySelectorAll<HTMLElement>('[data-result]') ?? [])
    const rows = new Map(nodes.map(node => [node.dataset.result!, node.offsetTop]))
    positions.current = {query: clean, rows}
    if (!previous || previous.query !== clean || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const node of nodes) {
      const animation = node.getAnimations()[0]
      const previousTop = previous.rows.get(node.dataset.result!)
      if (previousTop == null) {
        node.animate([{opacity: 0, transform: 'scale(.98)'}, {opacity: 1, transform: 'none'}],
          {duration: 280, easing: 'ease-out'})
      } else if (previousTop !== node.offsetTop) {
        animation?.cancel()
        node.animate([{transform: `translateY(${previousTop - node.offsetTop}px)`}, {transform: 'none'}],
          {duration: 445, easing: motionEasing('spring')})
      }
    }
  }, [clean, filter, hits, visible])

  const quote = (ref: DraftReference) => {
    const outcome = addDraftReference(workspaceDraftScope(workspace.id), ref)
    if (outcome === 'added') toast.success('已加入新任务草稿', {action: {label: '查看草稿', onClick: () => navigate(workspaceHref(workspace.id))}})
    else toast.message(outcome === 'busy' ? '新任务草稿正在核对发送结果' : '草稿中已有这条引用')
  }

  return <div ref={list} className="knowledge-search" data-narrow={narrow}>
    <div className="knowledge-search-main">
      <div className="knowledge-query">
        <Search className="size-[17px] shrink-0 text-faint" aria-hidden/>
        <input ref={queryInput} aria-label="检索工作区知识" value={query} maxLength={500} autoComplete="off"
          placeholder={`在 ${workspace.name} 的材料、记忆和会话摘要里检索`}
          onChange={event => setQuery(event.target.value)}/>
        {query && <Button size="icon-xs" variant="ghost" aria-label="清除检索词" onClick={() => {
          setQuery(''); queryInput.current?.focus()
        }}><X/></Button>}
      </div>
      <div role="group" className="knowledge-filters" aria-label="按来源筛选">
        {FILTERS.map(value => <button key={value} type="button" className="knowledge-filter" aria-pressed={value === filter} onClick={() => {
          if (value !== filter) {updateSearch({source: value === 'all' ? '' : value}); setOpen(false)}
        }}>{value === 'all' ? '全部' : SOURCE_LABEL[value]}</button>)}
      </div>
      {fallback && <p className="px-1 py-1.5 text-xs text-faint" role="status">{fallback}</p>}
      {error && <div className="knowledge-search-error" role="alert"><p>{error}</p>
        <Button size="xs" variant="ghost" onClick={() => setAttempt(value => value + 1)}>重试</Button>
      </div>}
      {!clean ? <div className="knowledge-empty"><Search aria-hidden/><p>输入关键词检索。任务中用到的结果会显示在「本次参考」里。</p>
        {suggestions.length > 0 && <div className="knowledge-suggestions">{suggestions.map(word =>
          <button key={word} type="button" title={word} onClick={() => {
            updateSearch({q: word.slice(0, 500), source: '', pick: ''})
            queryInput.current?.focus()
          }}>{word}</button>)}</div>}
      </div>
        : !hits.length && loading ? <div className="knowledge-empty" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden/><p>正在检索</p></div>
          : !hits.length ? error ? null : <div className="knowledge-empty"><p>在{filter === 'all' ? '工作区' : SOURCE_LABEL[filter]}中没有找到「{clean}」。</p></div>
            : <>
              <p className="knowledge-result-count">{hits.length} 条结果</p>
              <ul ref={resultList} className="relative" aria-label="检索结果" aria-busy={loading}>
                {hits.map(hit => {
                  const Icon = SOURCE_ICON[hit.source_type] ?? Bookmark
                  const key = referenceKey(hit)
                  return <li key={key} data-result={key}>
                    <button type="button" className="knowledge-result" aria-pressed={key === referenceKey(selected)}
                      aria-haspopup={narrow ? 'dialog' : undefined} onClick={event => {
                        opener.current = event.currentTarget
                        updateSearch({pick: key})
                        if (narrow) setOpen(true)
                      }}>
                      <span className="knowledge-result-icon">{hit.source_type === 'document_chunk'
                        ? <FileTypeBadge extension={fileExtension(hit.title)} compact/>
                        : <Icon className="size-[17px] shrink-0 text-faint" aria-hidden/>}</span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <strong className="text-sm font-medium wrap-anywhere">{sourceTitle(hit)}</strong>
                          <span className="text-xs text-faint">{sourceCaption(hit) || SOURCE_LABEL[hit.source_type]}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-relaxed wrap-anywhere text-muted-foreground">
                          <HitText text={hit.snippet} query={clean}/>
                        </span>
                      </span>
                    </button>
                  </li>
                })}
              </ul>
            </>}
    </div>
    {selected && (narrow ? <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto" onCloseAutoFocus={event => {event.preventDefault(); opener.current?.focus()}}>
        <DialogTitle className="sr-only">检索结果预览</DialogTitle>
        <DialogDescription className="sr-only">读取当前选择的来源。</DialogDescription>
        {open && <KnowledgeSource key={referenceKey(selected)} workspaceId={workspace.id} reference={selected}
          query={clean} refresh={change.signal} match={selected.payload.match_kind}
          onOpenFile={openFile} onQuote={canQuote ? quote : undefined}/>}
      </DialogContent>
    </Dialog> : <aside className="knowledge-preview" aria-label="检索预览">
      <KnowledgeSource key={referenceKey(selected)} workspaceId={workspace.id} reference={selected}
        query={clean} refresh={change.signal} match={selected.payload.match_kind}
        onOpenFile={openFile} onQuote={canQuote ? quote : undefined}/>
    </aside>)}
  </div>
}

function IndexView({workspace, visible, summary, summaryError, refreshSummary, acceptSummary, ocrAvailable}: {
  workspace: WorkspaceItem; visible: boolean; summary: IndexSummary | null; summaryError: string | null;
  refreshSummary: () => void; acceptSummary: (next: IndexSummary) => void; ocrAvailable: boolean
}) {
  const {id} = workspace
  const {change} = useWorkspaceLive()
  const [params] = useSearchParams()
  const {pathname} = useLocation()
  const restoreFile = params.get('indexFile')
  const restored = useRef(false)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [nextAfter, setNextAfter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pauseIntent, setPauseIntent] = useState<boolean | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [pages, setPages] = useState(() => Math.max(1, Number.parseInt(params.get('indexPages') ?? '1', 10) || 1))
  const [op, setOp] = useState<OperationView>()
  const [excluded, setExcluded] = useState<{version: number; paths: string[]} | null>(null)
  const latestRead = useRef(0)
  const acting = useRef(false)
  const bump = () => {refreshSummary(); setRefresh(previous => previous + 1)}
  const readOnly = workspace.status !== 'active' || workspace.folder?.status !== 'available'

  const documentOperation = summary?.active_operation_id
  const working = Boolean(documentOperation || summary && summary.pending + summary.parsing > 0
    && !summary.policy.paused && !summary.scope_review_required)
  const publicationGeneration = summary?.publication_generation
  useLayoutEffect(() => {
    if (!visible || !restoreFile || restored.current) return
    const row = document.getElementById(`knowledge-index-${restoreFile}`)
    if (row) {
      restored.current = true
      row.focus({preventScroll: true})
      row.scrollIntoView({block: 'nearest'})
    }
  }, [visible, restoreFile, documents])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let timer: number | undefined
    const read = async () => {
      const token = ++latestRead.current
      try {
        if (acting.current || document.hidden) return
        const operation = documentOperation ? operationApi.get(documentOperation).catch(() => undefined) : Promise.resolve(undefined)
        const loaded: DocumentItem[] = []
        let next: string | null | undefined
        for (let page = 0; page < pages; page++) {
          const data = await documentsApi.page(id, next ?? undefined)
          loaded.push(...data.items)
          next = data.next_after
          if (!next || cancelled || token !== latestRead.current) break
        }
        const operationView = await operation
        if (cancelled || token !== latestRead.current) return
        setDocuments(loaded); setNextAfter(next ?? null); setOp(operationView); setError(null)
      } catch (reason) {
        if (!cancelled && token === latestRead.current) setError(errorText(reason, '无法读取索引'))
      } finally {
        if (!cancelled && token === latestRead.current) timer = window.setTimeout(() => void read(), working ? 1800 : 10000)
      }
    }
    void read()
    return () => {cancelled = true; window.clearTimeout(timer)}
  }, [id, change.signal, refresh, pages, visible, documentOperation, working, publicationGeneration])

  const act = async (action: string, mutate: () => Promise<unknown>) => {
    if (acting.current || readOnly) return
    acting.current = true
    latestRead.current += 1
    setBusy(action); setMutationError(null)
    try {await mutate()}
    catch (reason) {setMutationError(errorText(reason, '索引操作失败'))}
    finally {acting.current = false; setPauseIntent(null); setBusy(null); bump()}
  }

  const update = async (changes: Partial<IndexPolicy>) => {
    if (!summary) return
    const requested = {...summary.policy, excluded_directories: summary.policy.excluded_directories ?? [], ...changes}
    try {
      acceptSummary(await documentsApi.policy(id, requested))
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.rejected) throw reason
      const latest = await documentsApi.summary(id).catch(() => null)
      if (latest) acceptSummary(latest)
      if (!latest || latest.policy.version <= requested.version ||
        latest.policy.paused !== requested.paused || latest.policy.scope_confirmed !== requested.scope_confirmed ||
        latest.policy.excluded_directories?.slice().sort().join('\n') !== requested.excluded_directories.slice().sort().join('\n')) throw reason
    }
    setExcluded(null)
  }

  if (!summary) return <div className="knowledge-empty" role={summaryError ? 'alert' : 'status'}>
    {summaryError ? <><p>{summaryError}</p><Button size="sm" variant="outline" onClick={bump}>重试</Button></>
      : <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden/><p>正在读取索引</p></>}
  </div>

  const policy = {...summary.policy, excluded_directories: summary.policy.excluded_directories ?? []}
  const paused = pauseIntent ?? policy.paused
  const editing = excluded?.version === policy.version ? excluded.paths : policy.excluded_directories
  const includedDirs = new Set(summary.scan.directories)
  const grouped = new Map<string, DocumentItem[]>()
  for (const doc of documents) {
    if (doc.status === 'excluded') continue
    const directory = doc.relative_path.includes('/') ? doc.relative_path.slice(0, doc.relative_path.lastIndexOf('/')) : ''
    const group = grouped.get(directory) ?? []
    group.push(doc)
    grouped.set(directory, group)
  }
  const errorLine = mutationError ?? summaryError ?? error ?? summary.last_error
  const semantic = summary.semantic
  const semanticProgress = semantic?.progress
  const counts = [
    {label: '可检索', count: summary.searchable, tone: 'ok'}, {label: '处理中', count: summary.pending + summary.parsing, tone: 'run'},
    {label: '待文字识别', count: summary.pending_component, tone: 'wait'}, {label: '失败', count: summary.failed, tone: 'failed'},
  ]
  return <div className="knowledge-index">
    <div className="knowledge-index-body">
      <dl className="knowledge-index-summary">
        {counts.map(item => <div className="flex flex-col-reverse" key={item.label}>
          <dt className="text-xs text-faint">{item.label}</dt>
          <dd className={cn('text-[22px] font-semibold tabular-nums', item.tone === 'failed' && 'text-state-failed',
            item.tone === 'wait' && 'text-state-waiting')}>{item.count}</dd>
        </div>)}
      </dl>
      <div className="knowledge-index-meter" aria-hidden>
        {counts.filter(item => item.count > 0).map(item => <span key={item.tone} data-tone={item.tone}
          className="knowledge-meter rounded-full" style={{flex: item.count}}/>)}
      </div>
      <p className="text-xs text-faint">范围 · {summary.scan.truncated ? '至少 ' : ''}{summary.scan.files} 个文件 · {formatFileSize(summary.scan.bytes)}
        {policy.excluded_directories.length > 0 && ` · 排除 ${policy.excluded_directories.length} 个目录`}
        {summary.scan.excluded_files > 0 && `（已知 ${summary.scan.excluded_files} 个文件）`}
      </p>
      {summary.scan.truncated && <p className="mt-1 text-xs text-state-waiting">扫描范围不完整，数字仅含已扫描的材料。</p>}
      {summary.scope_review_required && <section aria-label="确认索引范围" className="mt-4 space-y-2 rounded-xl border p-3">
        <p className="text-sm font-medium">先确认索引范围</p>
        <p className="text-meta text-muted-foreground">选择要排除的目录，再开始解析。</p>
        <div className="max-h-40 space-y-1 overflow-auto">
          {[...new Set([...includedDirs, ...editing])].sort().map(directory => <label key={directory} className="flex items-center gap-2 text-meta">
            <input type="checkbox" checked={editing.includes(directory)} disabled={readOnly || !!busy}
              onChange={event => setExcluded({version: policy.version, paths: event.target.checked
                ? [...editing, directory] : editing.filter(path => path !== directory)})}/>
            <span className="wrap-anywhere">{directory}/</span>
          </label>)}
        </div>
        <Button size="sm" disabled={readOnly || !!busy} onClick={() => void act('scope', () => update({
          scope_confirmed: true, excluded_directories: editing,
        }))}>确认纳入范围</Button>
      </section>}
      <div className="knowledge-index-tools">
        <WorkspaceSwitch label="后台索引" text={paused ? '索引已暂停' : '后台索引中'} alternate="后台索引中"
          checked={!paused} disabled={readOnly || (busy != null && busy !== 'pause')} pending={busy === 'pause'}
          onChange={enabled => void act('pause', async () => {
            setPauseIntent(!enabled)
            await update({paused: !enabled})
            toast.success(enabled ? '已继续索引' : '已暂停后台索引，已完成的仍可检索')
          })}/>
        <Button variant="ghost" size="sm" disabled={readOnly || !!busy}
          onClick={() => void act('scan', async () => {await documentsApi.sync(id); toast.message('正在重新扫描文件夹')})}><RefreshCw/>重新扫描</Button>
        {summary.failed > 0 && <Button className="ml-auto" variant="ghost" size="sm"
          disabled={readOnly || !!busy || policy.paused || summary.scope_review_required}
          onClick={() => void act('retry', () => documentsApi.retry(id))}>全部重试</Button>}
      </div>
      {readOnly && <p className="py-1 text-xs text-faint">{workspace.status === 'archived' ? '工作区已归档，索引设置为只读。' : '文件夹不可用，恢复连接后可管理索引。'}</p>}
      <p role="status" className="knowledge-index-progress">
        {op?.status === 'running' && op.phase && <>{op.phase}{op.progress?.completed ? ` · 已处理 ${op.progress.completed} 项` : ''}</>}
      </p>
      {semantic && <div className="my-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-meta">
        <span role="status">{semantic.state === 'not_installed' ? '等待语义组件' : SEMANTIC_LABEL[semantic.state]}
          {semanticProgress?.total != null && semanticProgress.total > 0 &&
            <span className="ml-2 text-xs tabular-nums text-faint">{semanticProgress.completed}/{semanticProgress.total} 个片段</span>}
        </span>
        {semanticProgress?.total != null && semanticProgress.total > 0 &&
          <progress aria-label="语义索引进度" className="h-1.5 w-24 accent-(--signal)" value={semanticProgress.completed} max={semanticProgress.total}/>}
        {semantic.error && <span className="text-xs text-state-failed" role="alert">{semantic.error}</span>}
        {semantic.state === 'failed' && <Button size="xs" variant="ghost" className="ml-auto"
          disabled={readOnly || !!busy || paused || summary.scope_review_required}
          onClick={() => void act('semantic', async () => {await documentsApi.retrySemantic(id)})}>重试语义索引</Button>}
      </div>}
      {(summary.ocr_pending > 0 || summary.ocr_failed > 0) && <p className="pb-2 text-xs text-faint" role="status">
        {summary.ocr_pending > 0 && `${summary.ocr_pending} 个可检索文件待补录扫描页`}
        {summary.ocr_pending > 0 && summary.ocr_failed > 0 && ' · '}
        {summary.ocr_failed > 0 && `${summary.ocr_failed} 个文件的扫描页补录失败`}
      </p>}
      {errorLine && <p role="alert" className="text-meta text-state-failed">{errorLine}
        <Button size="xs" variant="ghost" onClick={() => {setMutationError(null); bump()}}>刷新状态</Button>
      </p>}
      {grouped.size === 0 && !summary.scope_review_required && <p className="py-8 text-center text-meta text-faint">当前范围没有可索引的文件。</p>}
      {[...grouped].map(([directory, entries]) => <section key={directory}>
        <div className="knowledge-index-directory">
          <FolderOpen className="size-4 shrink-0 text-faint" aria-hidden/>
          <h2 className="min-w-0 truncate text-sm font-medium" title={directory}>{directory ? `${directory}/` : '工作区根目录'}</h2>
          <span className="knowledge-directory-meta">
            {summary.scan.directory_sizes?.[directory] ? `${summary.scan.truncated ? '至少 ' : ''}${summary.scan.directory_sizes[directory].files} 个文件`
              : !nextAfter ? `${entries.length} 个文件` : ''}
          </span>
          {directory && <Button size="xs" variant="ghost" title="排除索引，文件保留" disabled={readOnly || !!busy}
            onClick={() => void act('exclude', async () => {
              await update({excluded_directories: [...policy.excluded_directories, directory]})
              toast.success(`已排除 ${directory}/`)
            })}>排除</Button>}
        </div>
        <ul>{entries.map(doc => {
          const processing = ['registered', 'pending_parse', 'parsing', 'indexing'].includes(doc.status)
          const supplemental = doc.status === 'searchable' && ['waiting_component', 'pending', 'running'].includes(doc.ocr_state ?? '')
          const ocrFailed = doc.ocr_state === 'failed'
          const needsInstall = !ocrAvailable && (doc.status === 'pending_component' || doc.ocr_state === 'waiting_component')
          const status = ocrFailed ? '识别失败'
            : supplemental ? paused ? '可查 · 补录已暂停' : doc.ocr_state === 'running' ? '可查 · 正在补录' : '可查 · 待补录'
            : paused && (processing || doc.status === 'pending_component' && ocrAvailable) ? '已暂停'
            : doc.ocr_state === 'running' ? '识别中'
            : doc.status === 'pending_component' ? needsInstall ? '待安装' : '待处理'
            : STATUS[doc.status]
          const detail = doc.ocr_error || doc.error_message || (doc.ocr_pages_pending && supplemental ? `${doc.ocr_pages_pending} 页待补录`
            : doc.page_count != null ? `${doc.page_count} 页`
            : doc.size != null ? formatFileSize(doc.size) : '')
          const returnParams = new URLSearchParams(params)
          returnParams.set('indexFile', doc.id)
          returnParams.set('indexPages', String(pages))
          return <li key={doc.id} id={`knowledge-index-${doc.id}`} tabIndex={-1} className="knowledge-index-row">
            <FileTypeBadge extension={fileExtension(doc.relative_path)} compact/>
            <span className="min-w-0 truncate" title={doc.relative_path}>{doc.relative_path.split('/').at(-1)}</span>
            <span className="knowledge-index-row-meta" title={detail || undefined}>
              {detail}
            </span>
            <span className={cn('knowledge-index-row-status', (doc.status === 'failed' || ocrFailed) && 'text-state-failed',
              doc.status === 'searchable' && !ocrFailed && 'text-state-success', doc.status === 'pending_component' && 'text-state-waiting',
              processing && !paused && 'text-signal')}>
              {processing && !paused && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden/>}{status}</span>
            <span className="knowledge-index-row-action">
              {(doc.status === 'failed' || ocrFailed) && <Button size="xs" variant="ghost"
                disabled={readOnly || !!busy || policy.paused || summary.scope_review_required}
                onClick={() => void act('retry', () => documentsApi.retry(id, doc))}>重试</Button>}
              {needsInstall && <Button asChild size="xs" variant="ghost"><Link href={installHref('ocr', `${pathname}?${returnParams}`)}>安装文字识别</Link></Button>}
            </span>
          </li>
        })}</ul>
      </section>)}
      {policy.excluded_directories.map(directory => <div key={directory} className="knowledge-index-directory knowledge-index-excluded">
        <Folder className="size-4 shrink-0 text-faint" aria-hidden/>
        <span className="min-w-0 truncate text-sm" title={directory}>{directory}/</span>
        <span className="knowledge-directory-meta">已排除{summary.scan.excluded_directory_sizes?.[directory] &&
          ` · 已知 ${summary.scan.excluded_directory_sizes[directory].files} 个文件 · ${formatFileSize(summary.scan.excluded_directory_sizes[directory].bytes)}`}</span>
        <Button size="xs" variant="ghost" disabled={readOnly || !!busy} onClick={() => void act('include', async () => {
          await update({excluded_directories: policy.excluded_directories.filter(path => path !== directory)})
          toast.success(`已重新纳入 ${directory}/`)
        })}>重新纳入</Button>
      </div>)}
      {nextAfter && <Button size="sm" variant="ghost" onClick={() => setPages(previous => previous + 1)}>加载更多</Button>}
    </div>
  </div>
}
