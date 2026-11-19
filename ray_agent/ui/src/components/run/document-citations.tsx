import {useEffect, useMemo, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Eye, Quote} from '@/components/ui/icons'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {sourceLocation} from '@/lib/document-location'
import {draftDocument, useKnowledgeSource} from '@/components/workspace/knowledge-source'
import {memoryApi} from '@/lib/api/memory'
import type {KnowledgeReference} from '@/lib/api/types'
import type {DraftReference} from '@/lib/drafts'
import {FinalReply} from './messages'

function Citation({workspaceId, reference, number, onOpen, onQuote, sourceRefresh}: {
  workspaceId: string; reference: KnowledgeReference; number: number
  onOpen?: (ref: KnowledgeReference) => void; onQuote?: (ref: DraftReference) => void
  sourceRefresh?: number
}) {
  const [opened, setOpened] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const {state, retry} = useKnowledgeSource(workspaceId, reference, opened, refresh + (sourceRefresh ?? 0))
  const source = state && 'value' in state && state.value.kind === 'document' ? state.value.data : null
  return <Popover open={opened} onOpenChange={next => {if (next) setRefresh(value => value + 1); setOpened(next)}}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`查看引用 ${number}`}
        className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded-[5px] bg-signal-soft px-1 align-super text-[10px] leading-4 font-medium text-signal focus-visible:ring-2 focus-visible:ring-ring">
        {number}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-[min(21rem,calc(100vw-1.5rem))] space-y-2 text-meta motion-reduce:animate-none">
      {!state && <p role="status" className="text-faint">正在读取来源</p>}
      {state && 'error' in state && <div role="alert" className="space-y-1">
        <p className="text-state-failed">{state.error}</p>
        {!state.unavailable && <Button size="xs" variant="ghost" onClick={retry}>重试</Button>}
      </div>}
      {source && <>
        <div className="flex flex-wrap items-baseline gap-x-2"><b className="break-all font-medium">{source.title}</b>
          <span className="text-xs text-faint">v{source.revision} · {sourceLocation(source.locator)}</span>
          {source.stale && <span className="text-xs text-state-waiting">历史版本</span>}
        </div>
        <p className="max-h-32 overflow-y-auto rounded-lg bg-muted/60 p-2.5 whitespace-pre-wrap wrap-anywhere">{source.body.slice(0, 320)}</p>
        <div className="flex flex-wrap gap-1">
          {onOpen && <Button size="sm" variant="outline" onClick={() => {setOpened(false); onOpen(reference)}}>
            <Eye/>{source.stale ? '打开历史片段' : '打开原文'}
          </Button>}
          {onQuote && !source.stale && <Button size="sm" variant="ghost" onClick={() => {
            onQuote(draftDocument(source)); setOpened(false)
          }}><Quote/>引用到输入</Button>}
        </div>
      </>}
    </PopoverContent>
  </Popover>
}

export function DocumentCitedReply({runId, workspaceId, onOpen, onQuote, sourceRefresh, ...reply}: Parameters<typeof FinalReply>[0] & {
  runId?: string | null; workspaceId?: string
  onOpen?: (ref: KnowledgeReference) => void; onQuote?: (ref: DraftReference) => void
  sourceRefresh?: number
}) {
  const identifiers = useMemo(() => [...new Set(Array.from(reply.text.matchAll(/\]\(#rayagent-source-([a-zA-Z0-9_-]{1,128})\)/g), match => match[1]))], [reply.text])
  const enabled = !!runId && !!workspaceId && !reply.streaming && identifiers.length > 0
  const [state, setState] = useState<{runId: string; sources?: KnowledgeReference[]; error?: boolean}>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !runId) return
    let cancelled = false
    void memoryApi.contextManifest(runId).then(manifest => {
      if (!cancelled) setState({runId, sources: manifest.citation_sources ?? []})
    }, () => {if (!cancelled) setState({runId, error: true})})
    return () => {cancelled = true}
  }, [runId, enabled, attempt])
  const valid = identifiers.flatMap(id => state?.runId === runId
    ? state?.sources?.find(source => source.source_id === id) ?? [] : [])
  return <>
    <FinalReply {...reply} renderCitation={(sourceId, label) => {
      const index = valid.findIndex(source => source.source_id === sourceId)
      return index >= 0 && workspaceId ? <Citation workspaceId={workspaceId} reference={valid[index]} number={index + 1}
        onOpen={onOpen} onQuote={onQuote} sourceRefresh={sourceRefresh}/> : label
    }}/>
    {enabled && state?.runId === runId && state?.error && <Button variant="ghost" size="xs"
      onClick={() => setAttempt(value => value + 1)}>重读正文引用</Button>}
  </>
}
