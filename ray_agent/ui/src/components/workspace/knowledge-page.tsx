import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useLocation, useNavigate, useOutletContext, useSearchParams} from 'react-router'
import {toast} from 'sonner'
import {
  AlertCircle, Ban, Bookmark, Check, CircleCheck, CircleDashed, CircleMinus, ComponentInstall,
  Folder, FolderOpen, Layers, Loader2, Plus, RefreshCw, RotateCw, Scan, Search, SlidersHorizontal, X,
} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {fileExtension, FileTypeBadge} from '@/components/run/file-icon'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {WorkspaceSwitch} from './workspace-switch'
import {HitText, KnowledgeSource, SOURCE_ICON, SOURCE_LABEL, sourceCaption, sourceTitle} from './knowledge-source'
import {documentsApi, type DocumentItem, type IndexPolicy, type IndexSummary} from '@/lib/api/documents'
import {
  AGENT_OUTPUT_OPTIONS, DOCUMENT_CATEGORIES, excludeDirectory, excludeFile, fileIndexAction, includeDirectory,
  includeFile, normalizePolicy, samePolicy, setAgentOutputs, toggleCategory,
} from '@/lib/document-index-policy'
import type {RootSource} from '@/lib/api/preview'
import {componentsApi, type ComponentView} from '@/lib/api/components'
import {ApiError} from '@/lib/api/fetch'
import {memoryApi} from '@/lib/api/memory'
import {operationApi} from '@/lib/api/workspace'
import type {OperationView, SearchHitView, SearchResponse, WorkspaceItem} from '@/lib/api/types'
import {addDraftReference, referenceKey, workspaceDraftScope, type DraftReference} from '@/lib/drafts'
import {Link} from '@/lib/navigation'
import {useImeComposition} from '@/lib/ime'
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
      <KnowledgeSearch workspace={workspace} visible={view === 'search'} revision={`${searchRevision}:${publication}`}
        semantic={summary?.semantic} embedding={items?.find(item => item.component_id === 'embedding-e5')} returnTo={returnTo}/>
    </div>
    <div id="knowledge-view-panel-index" role="tabpanel" aria-labelledby="knowledge-view-index" hidden={view !== 'index'} className="knowledge-view">
      <IndexView workspace={workspace} visible={view === 'index'} summary={summary} summaryError={summaryError}
        refreshSummary={refresh} acceptSummary={acceptSummary} ocrAvailable={items?.some(item => item.component_id === 'ocr' && item.state === 'available') ?? false}/>
    </div>
  </main>
}

const URL_QUERY_SYNC_MS = 150

export function KnowledgeSearch({workspace, visible, revision, semantic, embedding, returnTo}: {
  workspace: WorkspaceItem; visible: boolean; revision: string; semantic?: IndexSummary['semantic'];
  embedding?: ComponentView; returnTo?: string
}) {
  const navigate = useNavigate()
  const {change} = useWorkspaceLive()
  const [params, setParams] = useSearchParams()
  const urlQuery = (params.get('q') ?? '').slice(0, 500)
  const [inputValue, setInputValue] = useState(urlQuery)
  const [committedQuery, setCommittedQuery] = useState(urlQuery)
  const ime = useImeComposition()
  const prevUrlQueryRef = useRef(urlQuery)
  const pendingUrlQueriesRef = useRef<string[]>([])
  const syncTimerRef = useRef<number | null>(null)
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
  const clean = committedQuery.trim()
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
  const updateSearch = useCallback((values: Record<string, string>) => {
    setParams(prev => {
      const updated = new URLSearchParams(prev)
      for (const [name, value] of Object.entries(values)) {
        if (value) updated.set(name, value)
        else updated.delete(name)
      }
      return updated
    }, {replace: true})
  }, [setParams])
  const recordPendingUrlQuery = useCallback((next: string) => {
    const pending = pendingUrlQueriesRef.current
    if (pending.length === 0 && next === prevUrlQueryRef.current) return
    if (pending.at(-1) !== next) pending.push(next)
  }, [])
  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
  }, [])
  const commitUrlQuery = useCallback((next: string, immediate = false) => {
    clearSyncTimer()
    const flush = () => {
      syncTimerRef.current = null
      recordPendingUrlQuery(next)
      updateSearch({q: next, pick: ''})
    }
    if (immediate) flush()
    else syncTimerRef.current = window.setTimeout(flush, URL_QUERY_SYNC_MS)
  }, [clearSyncTimer, recordPendingUrlQuery, updateSearch])
  useEffect(() => clearSyncTimer, [clearSyncTimer])
  useEffect(() => {
    if (urlQuery === prevUrlQueryRef.current) return
    prevUrlQueryRef.current = urlQuery
    const pending = pendingUrlQueriesRef.current
    const idx = pending.lastIndexOf(urlQuery)
    if (idx >= 0) {
      pending.splice(0, idx + 1)
      return
    }
    clearSyncTimer()
    pendingUrlQueriesRef.current = []
    setInputValue(urlQuery)
    setCommittedQuery(urlQuery)
  }, [urlQuery, clearSyncTimer])
  const openFile = (source: RootSource) => {
    const search = new URLSearchParams(params)
    if (committedQuery) search.set('q', committedQuery)
    else search.delete('q')
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
        <input ref={queryInput} aria-label="检索工作区知识" value={inputValue} maxLength={500} autoComplete="off"
          placeholder={`在 ${workspace.name} 的材料、记忆和会话摘要里检索`}
          onCompositionStart={() => ime.onCompositionStart()}
          onCompositionEnd={event => {
            ime.onCompositionEnd()
            const next = event.currentTarget.value.slice(0, 500)
            setInputValue(next)
            setCommittedQuery(next)
            setOpen(false)
            commitUrlQuery(next, false)
          }}
          onChange={event => {
            const next = event.target.value.slice(0, 500)
            setInputValue(next)
            const composing = ime.isComposing || Boolean((event.nativeEvent as {isComposing?: boolean} | undefined)?.isComposing)
            if (!composing) {
              setCommittedQuery(next)
              setOpen(false)
              commitUrlQuery(next, false)
            }
          }}/>
        {inputValue && <Button size="icon-xs" variant="ghost" aria-label="清除检索词" onClick={() => {
          setInputValue('')
          setCommittedQuery('')
          setOpen(false)
          commitUrlQuery('', true)
          queryInput.current?.focus()
        }}><X/></Button>}
      </div>
      <div role="group" className="knowledge-filters" aria-label="按来源筛选">
        {FILTERS.map(value => <button key={value} type="button" className="knowledge-filter" aria-pressed={value === filter} onClick={() => {
          if (value !== filter) {updateSearch({source: value === 'all' ? '' : value}); setOpen(false)}
        }}>{value === 'all' ? '全部' : SOURCE_LABEL[value]}</button>)}
      </div>
      {(() => {
        const installing = embedding?.state === 'fetching' || embedding?.state === 'verifying'
        const mode = semantic?.state === 'ready'
          ? {key: 'hybrid', text: '全文 + 语义检索已就绪', tone: 'text-state-success', install: false}
          : installing || semantic?.state === 'running' || semantic?.state === 'queued' || semantic?.state === 'pending'
            ? {key: 'building', text: '语义索引构建中 · 当前可先使用全文检索', tone: 'text-signal', install: false}
            : semantic?.state === 'not_installed' || (embedding && embedding.state !== 'available')
              ? {key: 'fts', text: '全文检索 · 未安装语义检索组件，按关键词匹配', tone: 'text-muted-foreground', install: true}
              : semantic?.state === 'failed'
                ? {key: 'failed', text: '全文检索 · 语义索引异常，可在索引页重试', tone: 'text-state-waiting', install: false}
                : semantic
                  ? {key: 'fts', text: '全文检索', tone: 'text-muted-foreground', install: false}
                  : null
        if (!mode) return null
        return <p className={cn('flex flex-wrap items-center gap-x-2 px-1 py-1 text-xs', mode.tone)} data-retrieval-mode={mode.key} role="status">
          <span>{mode.text}</span>
          {mode.install && returnTo && <Link className="text-signal hover:underline" href={installHref('embedding-e5', returnTo)}>安装语义检索</Link>}
        </p>
      })()}
      {fallback && reason === 'semantic_error' && <p className="px-1 py-1 text-xs text-state-waiting" role="status">{fallback}</p>}
      {error && <div className="knowledge-search-error" role="alert"><p>{error}</p>
        <Button size="xs" variant="ghost" onClick={() => setAttempt(value => value + 1)}>重试</Button>
      </div>}
      {!clean ? <div className="knowledge-empty"><Search aria-hidden/><p>输入关键词检索。任务中用到的结果会显示在「本次参考」里。</p>
        {suggestions.length > 0 && <div className="knowledge-suggestions">{suggestions.map(word =>
          <button key={word} type="button" title={word} onClick={() => {
            const next = word.slice(0, 500)
            clearSyncTimer()
            setInputValue(next)
            setCommittedQuery(next)
            setOpen(false)
            recordPendingUrlQuery(next)
            updateSearch({q: next, source: '', pick: ''})
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
  const navigate = useNavigate()
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
    const requested = normalizePolicy({...normalizePolicy(summary.policy), ...changes})
    try {
      acceptSummary(await documentsApi.policy(id, requested))
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.rejected) throw reason
      const latest = await documentsApi.summary(id).catch(() => null)
      if (latest) acceptSummary(latest)
      if (!latest || latest.policy.version <= requested.version || !samePolicy(normalizePolicy(latest.policy), requested)) throw reason
    }
    setExcluded(null)
  }

  if (!summary) return <div className="knowledge-empty" role={summaryError ? 'alert' : 'status'}>
    {summaryError ? <><p>{summaryError}</p><Button size="sm" variant="outline" onClick={bump}>重试</Button></>
      : <><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden/><p>正在读取索引</p></>}
  </div>

  const policy = normalizePolicy(summary.policy)
  const paused = pauseIntent ?? policy.paused
  const editing = excluded?.version === policy.version ? excluded.paths : policy.excluded_directories
  const pendingOutputs = summary.scan.pending_outputs ?? []
  const excludedFiles = policy.excluded_files ?? []
  const enabledCategories = policy.enabled_categories ?? []
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
      <div className="knowledge-index-panels">
        <section aria-label="索引范围" className="knowledge-panel-card">
          <header className="knowledge-panel-head">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
            <h2>索引范围</h2>
            <span className="knowledge-panel-sub">决定哪些文件自动收录进知识库</span>
          </header>
          <div className="knowledge-panel-rows">
            <div className="knowledge-setting-row">
              <div className="knowledge-setting-copy">
                <span className="knowledge-setting-title">内容类型</span>
                <span className="knowledge-setting-desc">可多选，关闭后对应类型不自动收录</span>
              </div>
              <div role="group" aria-label="索引内容类型" className="knowledge-governance-group">
                {DOCUMENT_CATEGORIES.map(category => {
                  const enabled = enabledCategories.includes(category.id)
                  return <button key={category.id} type="button" className="knowledge-category-check" aria-pressed={enabled}
                    disabled={readOnly || !!busy} onClick={() => void act(`category:${category.id}`, async () => {
                      await update(toggleCategory(policy, category.id, !enabled))
                      toast.success(enabled ? `已关闭「${category.label}」自动收录` : `已开启「${category.label}」自动收录`)
                    })}>
                    <span className="knowledge-category-box" aria-hidden>{enabled && <Check className="size-3"/>}</span>
                    <span>{category.label}</span>
                  </button>
                })}
              </div>
            </div>
            <div className="knowledge-setting-row">
              <div className="knowledge-setting-copy">
                <span className="knowledge-setting-title">Agent 产出</span>
                <span className="knowledge-setting-desc">
                  {policy.agent_outputs === 'manual' ? '任务生成的文件默认等待你确认后再加入知识库' : '符合已开启类型的任务成果将自动加入知识库'}
                </span>
              </div>
              <div className={cn('inline-flex shrink-0 items-center', (readOnly || !!busy) && 'pointer-events-none opacity-60')}>
                <SegmentedControl
                  idPrefix="knowledge-agent-outputs"
                  label="Agent 产出索引策略"
                  options={AGENT_OUTPUT_OPTIONS}
                  value={policy.agent_outputs}
                  onValueChange={next => {
                    if (readOnly || !!busy || policy.agent_outputs === next) return
                    void act(`outputs:${next}`, async () => {
                      await update(setAgentOutputs(policy, next))
                      toast.success(next === 'manual' ? 'Agent 产出文件将等待手动确认' : 'Agent 产出文件将自动加入知识库')
                    })
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section aria-label="索引运行" className="knowledge-panel-card">
          <header className="knowledge-panel-head">
            <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
            <h2>索引运行</h2>
            {(() => {
              const processingCount = summary.pending + summary.parsing
              const badge = paused
                ? {text: '已暂停', tone: 'paused'}
                : working
                  ? {text: processingCount > 0 ? `正在处理 ${processingCount} 项` : '处理中', tone: 'running'}
                  : {text: '自动运行中', tone: 'ready'}
              return <span className="knowledge-runtime-badge" data-tone={badge.tone} role="status">{badge.text}</span>
            })()}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="xs" disabled={readOnly || !!busy}
                onClick={() => void act('scan', async () => {await documentsApi.sync(id); toast.message('正在重新扫描文件夹')})}><RefreshCw className="size-3.5"/>重新扫描</Button>
              {summary.failed > 0 && <Button variant="outline" size="xs"
                disabled={readOnly || !!busy || policy.paused || summary.scope_review_required}
                onClick={() => void act('retry', () => documentsApi.retry(id))}>全部重试</Button>}
            </div>
          </header>
          <div className="knowledge-panel-rows">
            <div className="knowledge-setting-row">
              <div className="knowledge-setting-copy">
                <span className="knowledge-setting-title">后台自动索引</span>
                <span className="knowledge-setting-desc">
                  {readOnly
                    ? workspace.status === 'archived' ? '工作区已归档，索引设置为只读。' : '文件夹不可用，恢复连接后可管理索引。'
                    : '文件夹有新改动时自动更新知识库；暂停后已收录的内容仍可检索。'}
                </span>
              </div>
              <WorkspaceSwitch label="后台自动索引" text={paused ? '已关闭' : '已开启'} alternate="已开启"
                checked={!paused} disabled={readOnly || (busy != null && busy !== 'pause')} pending={busy === 'pause'}
                onChange={enabled => void act('pause', async () => {
                  setPauseIntent(!enabled)
                  await update({paused: !enabled})
                  toast.success(enabled ? '已开启后台自动索引' : '已暂停后台索引，已收录内容仍可检索')
                })}/>
            </div>
            {(op?.status === 'running' && op.phase || semantic || summary.ocr_pending > 0 || summary.ocr_failed > 0) && (
              <div className="knowledge-runtime-meta">
                {op?.status === 'running' && op.phase && <span role="status" className="text-xs text-signal">
                  {op.phase}{op.progress?.completed ? ` · 已处理 ${op.progress.completed} 项` : ''}
                </span>}
                {semantic && <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <span role="status">{semantic.state === 'not_installed' ? '未安装语义检索组件' : SEMANTIC_LABEL[semantic.state]}
                    {semanticProgress?.total != null && semanticProgress.total > 0 &&
                      <span className="ml-1.5 tabular-nums text-faint">{semanticProgress.completed}/{semanticProgress.total} 片段</span>}
                  </span>
                  {semanticProgress?.total != null && semanticProgress.total > 0 &&
                    <progress aria-label="语义索引进度" className="h-1.5 w-24 accent-(--signal)" value={semanticProgress.completed} max={semanticProgress.total}/>}
                  {semantic.error && <span className="text-state-failed" role="alert">{semantic.error}</span>}
                  {semantic.state === 'failed' && <IconAction label="重试语义索引"
                    disabled={readOnly || !!busy || paused || summary.scope_review_required}
                    onClick={() => void act('semantic', async () => {await documentsApi.retrySemantic(id)})}><RotateCw className="size-3.5"/></IconAction>}
                </div>}
                {(summary.ocr_pending > 0 || summary.ocr_failed > 0) && <span className="text-xs text-faint" role="status">
                  {summary.ocr_pending > 0 && `${summary.ocr_pending} 个文件待补录扫描页`}
                  {summary.ocr_pending > 0 && summary.ocr_failed > 0 && ' · '}
                  {summary.ocr_failed > 0 && `${summary.ocr_failed} 个扫描页补录失败`}
                </span>}
              </div>
            )}
          </div>
        </section>
      </div>

      {summary.scope_review_required && <section aria-label="确认索引范围" className="mt-4 space-y-2 rounded-xl border p-3">
        <p className="text-sm font-medium">先确认索引范围</p>
        <p className="text-meta text-muted-foreground">选择不需要收录的目录，再开始解析。</p>
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
        }))}>确认收录范围</Button>
      </section>}

      {errorLine && <p role="alert" className="mt-3 text-meta text-state-failed">{errorLine}
        <Button size="xs" variant="ghost" onClick={() => {setMutationError(null); bump()}}>刷新状态</Button>
      </p>}

      <div className="knowledge-scope-bar">
        <p className="text-xs text-faint tabular-nums">文件清单 · {summary.scan.truncated ? '至少 ' : ''}{summary.scan.files} 个文件 · {formatFileSize(summary.scan.bytes)}
          {policy.excluded_directories.length > 0 && ` · 跳过 ${policy.excluded_directories.length} 个目录`}
          {excludedFiles.length > 0 && ` · 跳过 ${excludedFiles.length} 个文件`}
          {(summary.scan.category_skipped ?? 0) > 0 && ` · 按类型跳过 ${summary.scan.category_skipped} 个`}
          {pendingOutputs.length > 0 && ` · 待确认 ${pendingOutputs.length} 个`}
          {summary.scan.excluded_files > 0 && `（共跳过 ${summary.scan.excluded_files} 个文件）`}
        </p>
        {summary.scan.truncated && <p className="mt-1 text-xs text-state-waiting">扫描范围不完整，数字仅含已扫描的材料。</p>}
      </div>

      {grouped.size === 0 && pendingOutputs.length === 0 && excludedFiles.length === 0 && !summary.scope_review_required
        && <p className="py-8 text-center text-meta text-faint">当前范围没有可收录的文件。</p>}
      {pendingOutputs.length > 0 && <section aria-label="Agent 产出待确认">
        <div className="knowledge-index-directory">
          <Layers className="size-4 shrink-0 text-signal" aria-hidden/>
          <h2 className="min-w-0 truncate text-sm font-medium">Agent 产出 · 待确认</h2>
          <span className="knowledge-directory-meta">{pendingOutputs.length} 个新文件等待加入知识库</span>
        </div>
        <ul>{pendingOutputs.map(path => <li key={path} className="knowledge-index-row">
          <FileTypeBadge extension={fileExtension(path)} compact/>
          <span className="min-w-0 truncate" title={path}>{path.split('/').at(-1)}</span>
          <span className="knowledge-index-row-meta" title={path}>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/' : '根目录'}</span>
          <span className="knowledge-index-row-status text-state-waiting" title="Agent 新生成的文件，点击右侧加入知识库">
            <CircleDashed className="size-3.5 shrink-0" aria-hidden/>待确认
          </span>
          <span className="knowledge-index-row-action">
            <IconAction label={`将「${path.split('/').at(-1)}」加入知识库`} disabled={readOnly || !!busy}
              onClick={() => void act(`include:${path}`, async () => {
                await update(includeFile(policy, path, true))
                toast.success(`已将「${path.split('/').at(-1)}」加入知识库`)
              })}><Plus className="size-3.5"/></IconAction>
          </span>
        </li>)}</ul>
      </section>}
      {[...grouped].map(([directory, entries]) => <section key={directory}>
        <div className="knowledge-index-directory">
          <FolderOpen className="size-4 shrink-0 text-faint" aria-hidden/>
          <h2 className="min-w-0 truncate text-sm font-medium" title={directory}>{directory ? `${directory}/` : '工作区根目录'}</h2>
          <span className="knowledge-directory-meta">
            {summary.scan.directory_sizes?.[directory] ? `${summary.scan.truncated ? '至少 ' : ''}${summary.scan.directory_sizes[directory].files} 个文件`
              : !nextAfter ? `${entries.length} 个文件` : ''}
          </span>
          {directory && <IconAction label={`将 ${directory}/ 移出知识库（保留原目录）`} disabled={readOnly || !!busy}
            onClick={() => void act('exclude', async () => {
              await update(excludeDirectory(policy, directory))
              toast.success(`已跳过 ${directory}/，原目录保持不变`)
            })}><CircleMinus className="size-3.5"/></IconAction>}
        </div>
        <ul>{entries.map(doc => {
          const processing = ['registered', 'pending_parse', 'parsing', 'indexing'].includes(doc.status)
          const supplemental = doc.status === 'searchable' && ['waiting_component', 'pending', 'running'].includes(doc.ocr_state ?? '')
          const ocrFailed = doc.ocr_state === 'failed'
          const needsInstall = !ocrAvailable && (doc.status === 'pending_component' || doc.ocr_state === 'waiting_component')
          const statusMeta = ocrFailed
            ? {label: '失败', tip: doc.ocr_error || '扫描页识别失败，点击右侧重试', tone: 'text-state-failed', icon: 'failed' as const}
            : doc.status === 'failed'
              ? {label: '失败', tip: doc.error_message || '处理失败，点击右侧重试', tone: 'text-state-failed', icon: 'failed' as const}
              : supplemental
                ? {label: '已收录', tip: paused ? '正文已可检索，扫描页补录已暂停' : '正文已可检索，正在补录扫描页文字', tone: 'text-state-success', icon: 'ok' as const}
                : paused && (processing || doc.status === 'pending_component' && ocrAvailable)
                  ? {label: '已暂停', tip: '后台索引已暂停', tone: 'text-muted-foreground', icon: 'paused' as const}
                  : doc.ocr_state === 'running' || processing
                    ? {label: '处理中', tip: STATUS[doc.status] || '正在读取并建立索引', tone: 'text-signal', icon: 'loading' as const}
                    : doc.status === 'pending_component'
                      ? {label: needsInstall ? '待识图' : '处理中', tip: needsInstall ? '需安装「文字识别」组件后读取扫描件' : '等待文字识别处理', tone: 'text-state-waiting', icon: 'scan' as const}
                      : doc.status === 'searchable'
                        ? {label: '已收录', tip: '已进入知识库，可被检索和引用', tone: 'text-state-success', icon: 'ok' as const}
                        : {label: STATUS[doc.status], tip: STATUS[doc.status], tone: 'text-muted-foreground', icon: 'paused' as const}
          const detail = doc.ocr_error || doc.error_message || (doc.ocr_pages_pending && supplemental ? `${doc.ocr_pages_pending} 页待补录`
            : doc.page_count != null ? `${doc.page_count} 页`
            : doc.size != null ? formatFileSize(doc.size) : '')
          const returnParams = new URLSearchParams(params)
          returnParams.set('indexFile', doc.id)
          returnParams.set('indexPages', String(pages))
          const filename = doc.relative_path.split('/').at(-1) ?? doc.relative_path
          return <li key={doc.id} id={`knowledge-index-${doc.id}`} tabIndex={-1} className="knowledge-index-row">
            <FileTypeBadge extension={fileExtension(doc.relative_path)} compact/>
            <span className="min-w-0 truncate" title={doc.relative_path}>{filename}</span>
            <span className="knowledge-index-row-meta" title={detail || undefined}>
              {detail}
            </span>
            <span className={cn('knowledge-index-row-status', statusMeta.tone)} title={statusMeta.tip}>
              {statusMeta.icon === 'ok' && <CircleCheck className="size-3.5 shrink-0" aria-hidden/>}
              {statusMeta.icon === 'loading' && <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden/>}
              {statusMeta.icon === 'failed' && <AlertCircle className="size-3.5 shrink-0" aria-hidden/>}
              {statusMeta.icon === 'scan' && <Scan className="size-3.5 shrink-0" aria-hidden/>}
              {statusMeta.icon === 'paused' && <CircleDashed className="size-3.5 shrink-0" aria-hidden/>}
              {statusMeta.label}
            </span>
            <span className="knowledge-index-row-action">
              {(doc.status === 'failed' || ocrFailed) && <IconAction label={`重新处理「${filename}」`}
                disabled={readOnly || !!busy || policy.paused || summary.scope_review_required}
                onClick={() => void act('retry', () => documentsApi.retry(id, doc))}><RotateCw className="size-3.5"/></IconAction>}
              {needsInstall && <IconAction label="安装文字识别组件"
                onClick={() => void navigate(installHref('ocr', `${pathname}?${returnParams}`))}><ComponentInstall className="size-3.5"/></IconAction>}
              <IconAction label={`将「${filename}」移出知识库（保留原文件）`} disabled={readOnly || !!busy}
                onClick={() => void act(`exclude-file:${doc.relative_path}`, async () => {
                  await update(excludeFile(policy, doc.relative_path))
                  toast.success(`已跳过「${filename}」，原文件保持不变`)
                })}><CircleMinus className="size-3.5"/></IconAction>
            </span>
          </li>
        })}</ul>
      </section>)}
      {excludedFiles.length > 0 && <section aria-label="已跳过的文件" className="knowledge-index-excluded">
        <div className="knowledge-index-directory">
          <h2 className="min-w-0 truncate text-sm font-medium">已跳过的文件</h2>
          <span className="knowledge-directory-meta">{excludedFiles.length} 个文件不进入检索</span>
        </div>
        <ul>{excludedFiles.map(path => {
          const filename = path.split('/').at(-1) ?? path
          return <li key={path} className="knowledge-index-row">
            <FileTypeBadge extension={fileExtension(path)} compact/>
            <span className="min-w-0 truncate" title={path}>{filename}</span>
            <span className="knowledge-index-row-meta" title={path}>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/' : '根目录'}</span>
            <span className="knowledge-index-row-status text-faint" title="已跳过此文件，原文件仍保留在文件夹中">
              <Ban className="size-3.5 shrink-0" aria-hidden/>不收录
            </span>
            <span className="knowledge-index-row-action">
              <IconAction label={`将「${filename}」重新加入知识库`} disabled={readOnly || !!busy}
                onClick={() => void act(`include-file:${path}`, async () => {
                  const action = fileIndexAction(path, summary)
                  await update(includeFile(policy, path, action?.kind === 'include' ? action.needsExplicitInclude : false))
                  toast.success(`已将「${filename}」重新加入知识库`)
                })}><Plus className="size-3.5"/></IconAction>
            </span>
          </li>
        })}</ul>
      </section>}
      {policy.excluded_directories.map(directory => <div key={directory} className="knowledge-index-directory knowledge-index-excluded">
        <Folder className="size-4 shrink-0 text-faint" aria-hidden/>
        <span className="min-w-0 truncate text-sm" title={directory}>{directory}/</span>
        <span className="knowledge-directory-meta">不收录{summary.scan.excluded_directory_sizes?.[directory] &&
          ` · 已知 ${summary.scan.excluded_directory_sizes[directory].files} 个文件 · ${formatFileSize(summary.scan.excluded_directory_sizes[directory].bytes)}`}</span>
        <IconAction label={`恢复收录 ${directory}/`} disabled={readOnly || !!busy} onClick={() => void act('include', async () => {
          await update(includeDirectory(policy, directory))
          toast.success(`已恢复收录 ${directory}/`)
        })}><Plus className="size-3.5"/></IconAction>
      </div>)}
      {nextAfter && <Button size="sm" variant="ghost" onClick={() => setPages(previous => previous + 1)}>加载更多</Button>}
    </div>
  </div>
}
