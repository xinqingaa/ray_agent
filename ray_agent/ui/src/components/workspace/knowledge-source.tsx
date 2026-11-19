import {useEffect, useState} from 'react'
import {ArrowLeft, Bookmark, FileText, Loader2, MessageCircle, Quote} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {FilePreview} from '@/components/preview/file-preview'
import {fileExtension, FileTypeBadge} from '@/components/run/file-icon'
import {Link} from '@/lib/navigation'
import {workspaceBackgroundHref, workspaceSessionHref} from '@/lib/workspace-route'
import {documentsApi, type DocumentLocator, type DocumentSource} from '@/lib/api/documents'
import {memoryApi} from '@/lib/api/memory'
import {ApiError} from '@/lib/api/fetch'
import type {RootSource} from '@/lib/api/preview'
import {isDesktop, revealInFileManager} from '@/lib/platform'
import type {KnowledgeReference, MemoryType, SearchHitView} from '@/lib/api/types'
import {sourceLocation} from '@/lib/document-location'
import type {DraftReference} from '@/lib/drafts'
import {MEMORY_TYPE_LABEL} from '@/lib/memory-labels'
import {formatDayLabel} from '@/lib/utils'
import {toast} from 'sonner'

export const SOURCE_LABEL = {document_chunk: '文件', memory: '记忆', session_summary: '会话摘要'} as const
export const SOURCE_ICON = {document_chunk: FileText, memory: Bookmark, session_summary: MessageCircle}

export function sourceTitle(hit: SearchHitView) {
  if (hit.source_type !== 'memory') return hit.title
  const type = MEMORY_TYPE_LABEL[hit.payload.memory_type as MemoryType]
  return type ? `记忆 · ${type}` : '记忆'
}

export function sourceCaption(hit: SearchHitView) {
  if (hit.source_type === 'document_chunk') return sourceLocation(hit.payload.locator as DocumentLocator | undefined)
  if (hit.source_type === 'session_summary') return ['会话摘要', formatDayLabel(hit.payload.source_at)].filter(Boolean).join(' · ')
  return hit.payload.origin === 'user' ? '你添加' : hit.payload.origin === 'auto_extraction' ? '自动提炼' : '记忆'
}

export function HitText({text, query}: {text: string; query: string}) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = terms.length ? text.split(new RegExp(`(${terms.join('|')})`, 'giu')) : [text]
  return <>{parts.map((part, index) => index % 2 ? <mark key={index}
    className="rounded-xs bg-signal-soft px-0.5 text-foreground">{part}</mark> : part)}</>
}

type LoadedSource = {kind: 'document'; data: DocumentSource}
  | {kind: 'entry'; data: SearchHitView}
type SourceState = {value: LoadedSource} | {error: string; unavailable: boolean}

export function useKnowledgeSource(workspaceId: string, ref: KnowledgeReference, enabled = true, refresh = 0) {
  const {source_id, source_type, source_version} = ref
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([workspaceId, source_type, source_id, source_version, attempt, refresh, enabled])
  const [result, setResult] = useState<{key: string; state: SourceState}>()
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    const identity = {source_id, source_type, source_version}
    const load: Promise<LoadedSource> = source_type === 'document_chunk'
      ? documentsApi.source(workspaceId, identity, abort.signal).then(data => ({kind: 'document', data}))
      : memoryApi.source(workspaceId, identity, abort.signal).then(data => ({kind: 'entry', data}))
    void load.then(value => {
      if (!abort.signal.aborted) setResult({key, state: {value}})
    }, reason => {
      if (abort.signal.aborted) return
      const unavailable = reason instanceof ApiError && [403, 404, 410].includes(reason.status)
      setResult({key, state: {error: reason instanceof Error ? reason.message : '无法读取来源', unavailable}})
    })
    return () => abort.abort()
  }, [key, enabled, workspaceId, source_id, source_type, source_version])
  return {state: result?.key === key ? result.state : undefined, retry: () => setAttempt(previous => previous + 1)}
}

export function draftDocument(source: DocumentSource): DraftReference {
  return {source_type: 'document_chunk', source_id: source.source_id, source_version: source.revision,
    label: source.relative_path, location: sourceLocation(source.locator)}
}

function columnName(index: number) {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}

function SourceExcerpt({source, query}: {source: DocumentSource; query: string}) {
  const rows = source.locator.rows
  if (source.cells?.length && rows?.length) {
    const width = Math.max(0, ...source.cells.map(row => row.length))
    return <div className="overflow-auto rounded-lg border bg-preview-sheet text-preview-sheet-foreground">
      <table aria-label={sourceLocation(source.locator)} className="w-full border-collapse text-left text-xs tabular-nums">
        <thead><tr><th className="border-b bg-muted p-2"/>
          {Array.from({length: width}, (_, i) => <th key={i} scope="col" className="border-b border-l bg-muted px-2 py-1.5 text-center text-faint">
            {columnName(i + (source.locator.column_start ?? 1) - 1)}
          </th>)}
        </tr></thead>
        <tbody>{source.cells.map((row, index) => <tr key={rows[index] ?? index}>
          <th scope="row" className="border-b bg-muted px-2 py-1.5 text-right text-faint">{rows[index] ?? '—'}</th>
          {Array.from({length: width}, (_, column) => <td key={column} className="min-w-14 border-b border-l px-2 py-1.5 whitespace-pre-wrap wrap-anywhere">
            <HitText text={row[column] ?? ''} query={query}/>
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
  }
  return <div className="knowledge-paper">
    {sourceLocation(source.locator) && <p className="knowledge-paper-location">{sourceLocation(source.locator)}</p>}
    {source.locator.heading && <p className="mb-2 text-xs font-medium">{source.locator.heading}</p>}
    <div className="whitespace-pre-wrap wrap-anywhere"><HitText text={source.body} query={query}/></div>
  </div>
}

function originalSource(source: DocumentSource): RootSource {
  const {page, block, table, sheet, cell_range, column_start} = source.locator
  const firstRow = cell_range?.match(/^[A-Z]+(\d+)/)?.[1]
  const location = source.format === 'pdf' && page != null ? {page}
    : source.format === 'docx' ? table != null ? {table} : block != null ? {block} : undefined
    : source.format === 'xlsx' && sheet ? {sheet_name: sheet, row: firstRow ? Number(firstRow) - 1 : 0,
      column: column_start ? column_start - 1 : 0}
    : undefined
  return {kind: 'root', rootId: source.root_id, path: source.relative_path, filename: source.title,
    location, expectedRevision: source.preview_revision ?? undefined}
}

export function KnowledgeSource({workspaceId, reference, query = '', refresh, match, onQuote, onBack, onOpenFile, showOriginal = false}: {
  workspaceId: string; reference: KnowledgeReference; query?: string; refresh?: number
  match?: unknown; onQuote?: (ref: DraftReference) => void; onBack?: () => void
  onOpenFile?: (source: RootSource) => void; showOriginal?: boolean
}) {
  const {state, retry} = useKnowledgeSource(workspaceId, reference, true, refresh)
  const matched = match === 'hybrid' ? '全文与语义匹配' : match === 'semantic' ? '语义相近' : match === 'full_text' ? '全文匹配' : ''
  return <div className="knowledge-source">
    {onBack && <Button type="button" size="sm" variant="ghost" onClick={onBack}><ArrowLeft/>返回</Button>}
    {!state ? <p role="status" className="flex items-center gap-2 text-meta text-faint"><Loader2 className="size-4 animate-spin motion-reduce:animate-none"/>正在读取来源</p>
      : 'error' in state ? <div role="alert" className="space-y-2 rounded-xl border p-3">
        <p className="font-medium">{state.unavailable ? '来源不可读' : '读取来源失败'}</p>
        <p className="text-meta text-muted-foreground">{state.error}</p>
        {!state.unavailable && <Button variant="outline" size="sm" onClick={retry}>重试</Button>}
      </div> : state.value.kind === 'document' ? (() => {
        const source = state.value.data
        const label = sourceLocation(source.locator)
        return <>
          <header className="knowledge-source-head">
            <FileTypeBadge extension={fileExtension(source.relative_path)} compact/>
            <strong className="min-w-0 wrap-anywhere font-medium">{source.title || source.relative_path}</strong>
            <span className="text-xs tabular-nums text-faint">v{source.revision}</span>
            {label && <span className="text-xs text-faint">{label}</span>}
          </header>
          <SourceExcerpt source={source} query={query}/>
          {showOriginal && !source.stale && ['pdf', 'docx'].includes(source.format) && source.preview_revision &&
            <div className="h-[min(50vh,32rem)] min-h-56"><FilePreview source={originalSource(source)}/></div>}
          <div className="knowledge-source-actions">
            {onQuote && !source.stale && <Button size="sm" onClick={() => onQuote(draftDocument(source))}><Quote/>引用到新任务</Button>}
            {!source.stale && onOpenFile && <Button size="sm" variant="ghost"
              onClick={() => onOpenFile(originalSource(source))}>在文件夹中打开</Button>}
            {!onOpenFile && isDesktop() && <Button size="sm" variant="ghost" onClick={() => {
              void revealInFileManager(source.root_id, source.relative_path)
                .catch(error => toast.error(error instanceof Error ? error.message : '无法在文件夹中定位'))
            }}>{source.stale ? '在文件夹中显示当前文件' : '在文件夹中显示'}</Button>}
          </div>
          <p className={source.stale ? 'text-xs text-state-waiting' : 'text-xs text-faint'}>
            {[matched, source.stale ? '历史版本 · 已保存的解析片段' : '当前版本',
              source.format === 'xlsx' && !source.locator.cell_range ? '此版本仅可定位到工作表' : ''].filter(Boolean).join(' · ')}
          </p>
        </>
      })() : (() => {
        const hit = state.value.data
        const Icon = SOURCE_ICON[hit.source_type]
        const event = hit.payload.source_seq
        const href = hit.source_type === 'memory' ? `${workspaceBackgroundHref(workspaceId)}#memory-${encodeURIComponent(hit.source_id)}`
          : `${workspaceSessionHref(workspaceId, hit.source_id)}${typeof event === 'number' && event > 0 ? `#event-${event}` : ''}`
        return <>
          <header className="knowledge-source-head"><Icon className="size-4 text-faint" aria-hidden/>
            <strong className="font-medium">{sourceTitle(hit)}</strong><span className="text-xs text-faint">{sourceCaption(hit)}</span>
          </header>
          <p className="knowledge-paper">
            <HitText text={hit.snippet} query={query}/>
          </p>
          <div className="knowledge-source-actions">
            {onQuote && <Button size="sm" onClick={() => onQuote({
              source_type: hit.source_type, source_id: hit.source_id, source_version: hit.source_version, label: sourceTitle(hit),
            })}><Quote/>引用到新任务</Button>}
            <Button asChild variant="ghost" size="sm"><Link href={href}>{hit.source_type === 'memory' ? '在背景中查看' : '打开对话'}</Link></Button>
          </div>
          {matched && <p className="text-xs text-faint">{matched}</p>}
        </>
      })()}
  </div>
}
