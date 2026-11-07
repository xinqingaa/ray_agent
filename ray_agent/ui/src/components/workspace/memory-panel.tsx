import {useCallback, useEffect, useMemo, useState} from 'react'
import {Loader2, Pin, PinOff, Plus, Search} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {ScrollArea} from '@/components/ui/scroll-area'
import {Select} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {Textarea} from '@/components/ui/textarea'
import {memoryApi} from '@/lib/api/memory'
import {ApiError} from '@/lib/api/fetch'
import type {MemoryItem, MemoryType, SearchHitView, WorkspaceItem} from '@/lib/api/types'
import {MEMORY_TYPE_LABEL, MEMORY_TYPE_OPTIONS} from '@/lib/memory-labels'
import {describeWorkspace} from '@/lib/workspace-state'
import {cn} from '@/lib/utils'

type Section = 'resident' | 'searchable' | 'candidates' | 'search'

function groupMemories(items: MemoryItem[]) {
  const resident: MemoryItem[] = []
  const searchable: MemoryItem[] = []
  const candidates: MemoryItem[] = []
  for (const item of items) {
    if (item.status === 'candidate') candidates.push(item)
    else if (item.resident) resident.push(item)
    else if (item.status === 'active') searchable.push(item)
  }
  return {resident, searchable, candidates}
}

function MemoryRow({
  item,
  workspaceId,
  readonly,
  onUpdated,
}: {
  item: MemoryItem
  workspaceId: string
  readonly: boolean
  onUpdated: (item: MemoryItem) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const [type, setType] = useState<MemoryType>(item.memory_type)
  const [busy, setBusy] = useState(false)

  const act = async (action: Parameters<typeof memoryApi.patch>[2]) => {
    if (busy || readonly) return
    setBusy(true)
    try {
      onUpdated(await memoryApi.patch(workspaceId, item.id, action))
      if (action.action === 'edit') setEditing(false)
      if (action.action === 'confirm') toast.success('已确认')
      if (action.action === 'retract') toast.success('已撤回')
      if (action.action === 'undo') toast.success('已撤销变更')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {setBusy(false)}
  }

  return (
    <li className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        <span>{MEMORY_TYPE_LABEL[item.memory_type]}</span>
        {item.pinned && <span className="text-signal">已钉住</span>}
        {item.resident && <span>常驻</span>}
        {item.status === 'candidate' && <span className="text-state-waiting">待确认</span>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={draft} disabled={busy} rows={3} aria-label="记忆内容" onChange={event => setDraft(event.target.value)}/>
          <Select
            value={type}
            label="记忆类型"
            disabled={busy}
            className="mt-0 w-full"
            options={MEMORY_TYPE_OPTIONS.map(option => ({id: option.value, label: option.label}))}
            onChange={value => setType(value as MemoryType)}
          />
          <div className="flex gap-2">
            <Button type="button" size="xs" disabled={busy || !draft.trim()} onClick={() => void act({action: 'edit', version: item.version, content: draft.trim(), memory_type: type})}>保存</Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => {setEditing(false); setDraft(item.content); setType(item.memory_type)}}>取消</Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.content}</p>
      )}
      {!editing && (
        <div className="mt-2 flex flex-wrap gap-1">
          {!readonly && item.status === 'candidate' && (
            <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => void act({action: 'confirm', version: item.version})}>确认</Button>
          )}
          {!readonly && item.status === 'active' && (
            <>
              <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>编辑</Button>
              <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void act({action: item.pinned ? 'unpin' : 'pin', version: item.version})}>
                {item.pinned ? <><PinOff className="size-3" aria-hidden/>取消钉住</> : <><Pin className="size-3" aria-hidden/>钉住</>}
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void act({action: 'retract', version: item.version})}>撤回</Button>
            </>
          )}
          {!readonly && (
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void act({action: 'undo', version: item.version})}>撤销变更</Button>
          )}
        </div>
      )}
    </li>
  )
}

function SearchHits({hits}: {hits: SearchHitView[]}) {
  if (hits.length === 0) return <p className="py-4 text-center text-meta text-muted-foreground">没有命中</p>
  return (
    <ul className="space-y-2">
      {hits.map(hit => (
        <li key={`${hit.source_type}:${hit.source_id}`} className="rounded-lg border px-3 py-2">
          <p className="text-xs text-faint">{
            hit.source_type === 'memory' ? '记忆'
              : hit.source_type === 'session_summary' ? '对话摘要'
                : hit.source_type === 'document_chunk' ? '文件'
                  : hit.source_type}
            {hit.source_type === 'document_chunk' && typeof hit.payload?.relative_path === 'string'
              ? ` · ${hit.payload.relative_path}` : ''}
            {hit.stale ? ' · 已过期' : ''}
          </p>
          <p className="mt-0.5 text-sm font-medium">{hit.title || hit.snippet.slice(0, 120)}</p>
          {hit.title && <p className="mt-1 text-meta text-muted-foreground">{hit.snippet}</p>}
        </li>
      ))}
    </ul>
  )
}

export function MemoryPanel({workspace, open, onOpenChange, onMemoryCreated}: {
  workspace: WorkspaceItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 手动新增记忆后通知外层（例如用于同步） */
  onMemoryCreated?: (item: MemoryItem) => void
}) {
  const condition = describeWorkspace(workspace)
  const readonly = condition.archived || condition.deleting
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [residentLimit, setResidentLimit] = useState(12)
  const [section, setSection] = useState<Section>('resident')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHitView[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<MemoryType>('fact')

  const grouped = useMemo(() => groupMemories(items), [items])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await memoryApi.list(workspace.id, ['active', 'candidate'])
      setItems(data.memories)
      setResidentLimit(data.resident_limit)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取记忆失败')
    } finally {setLoading(false)}
  }, [workspace.id])

  useEffect(() => {
    if (!open) return
    void reload()
  }, [open, reload])

  const replaceItem = (next: MemoryItem) => {
    setItems(current => {
      const index = current.findIndex(item => item.id === next.id)
      if (index < 0) return [...current, next]
      const copy = [...current]
      copy[index] = next
      return copy
    })
  }

  const runSearch = async () => {
    const query = searchQuery.trim()
    if (!query) return
    setSearching(true)
    setSection('search')
    try {
      setSearchHits((await memoryApi.search(workspace.id, {query, limit: 20})).hits)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '检索失败')
      setSearchHits([])
    } finally {setSearching(false)}
  }

  const createMemory = async () => {
    const content = newContent.trim()
    if (!content || creating || readonly) return
    setCreating(true)
    try {
      const item = await memoryApi.create(workspace.id, {content, memory_type: newType, pinned: false})
      replaceItem(item)
      onMemoryCreated?.(item)
      setNewContent('')
      toast.success('已记住', {
        action: {
          label: '撤销',
          onClick: () => {
            void memoryApi.patch(workspace.id, item.id, {action: 'undo', version: item.version})
              .then(replaceItem)
              .catch(err => toast.error(err instanceof Error ? err.message : '撤销失败'))
          },
        },
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') toast.error('记忆已被修改，请刷新后重试')
      else toast.error(error instanceof Error ? error.message : '新增失败')
    } finally {setCreating(false)}
  }

  const sectionItems = section === 'resident' ? grouped.resident
    : section === 'searchable' ? grouped.searchable
    : section === 'candidates' ? grouped.candidates
    : []

  const tabs: {id: Section; label: string; count?: number}[] = [
    {id: 'resident', label: '常驻', count: grouped.resident.length},
    {id: 'searchable', label: '可检索', count: grouped.searchable.length},
    {id: 'candidates', label: '待确认', count: grouped.candidates.length},
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle>工作区记忆</SheetTitle>
          <SheetDescription>
            常驻 {grouped.resident.length}/{residentLimit} · 可检索与待确认条目可编辑、钉住或撤回。
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b px-3 py-2">
            <form className="flex gap-2" onSubmit={event => {event.preventDefault(); void runSearch()}}>
              <Input value={searchQuery} placeholder="检索记忆与对话摘要" aria-label="检索" onChange={event => setSearchQuery(event.target.value)}/>
              <Button type="submit" size="icon-sm" variant="secondary" disabled={searching || !searchQuery.trim()} aria-label="检索">
                {searching ? <Loader2 className="size-4 animate-spin"/> : <Search className="size-4"/>}
              </Button>
            </form>
            <div className="flex gap-1">
              {tabs.map(tab => (
                <Button key={tab.id} type="button" size="xs" variant={section === tab.id ? 'secondary' : 'ghost'}
                  onClick={() => setSection(tab.id)}>
                  {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
                </Button>
              ))}
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-3">
              {loading && (
                <p className="flex items-center justify-center gap-2 py-8 text-meta text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden/>正在读取
                </p>
              )}
              {!loading && section === 'search' && searchHits != null && <SearchHits hits={searchHits}/>}
              {!loading && section !== 'search' && (
                <>
                  {sectionItems.length === 0 && (
                    <p className="py-8 text-center text-meta text-muted-foreground">
                      {section === 'candidates' ? '没有待确认的候选。' : '这一类还没有条目。'}
                    </p>
                  )}
                  <ul className={cn('space-y-2', sectionItems.length === 0 && 'hidden')}>
                    {sectionItems.map(item => (
                      <MemoryRow key={item.id} item={item} workspaceId={workspace.id} readonly={readonly} onUpdated={replaceItem}/>
                    ))}
                  </ul>
                </>
              )}
              {!readonly && (
                <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">手动新增</p>
                  <Textarea value={newContent} rows={2} placeholder="写下要记住的内容" aria-label="新记忆" disabled={creating} onChange={event => setNewContent(event.target.value)}/>
                  <div className="mt-2 flex gap-2">
                    <Select
                      value={newType}
                      label="记忆类型"
                      disabled={creating}
                      className="mt-0 w-[7rem]"
                      options={MEMORY_TYPE_OPTIONS.map(option => ({id: option.value, label: option.label}))}
                      onChange={value => setNewType(value as MemoryType)}
                    />
                    <Button type="button" size="sm" disabled={creating || !newContent.trim()} onClick={() => void createMemory()}>
                      <Plus className="size-3.5" aria-hidden/>记住
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
