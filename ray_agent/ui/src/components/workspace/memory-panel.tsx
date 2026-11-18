import {useCallback, useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
import {useLocation} from 'react-router'
import {AlertTriangle, Grip, Loader2, Pencil, Pin, PinOff, Plus, Search, Undo2, X} from '@/components/ui/icons'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Select} from '@/components/ui/select'
import {Textarea} from '@/components/ui/textarea'
import {IconAction} from '@/components/ui/icon-action'
import {Switch} from '@/components/ui/switch'
import {MemorySources} from './memory-sources'
import {memoryApi} from '@/lib/api/memory'
import {instructionApi} from '@/lib/api/instruction'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {ApiError} from '@/lib/api/fetch'
import type {MemoryItem, MemoryType, PatchMemoryRequest, SearchHitView, WorkspaceItem} from '@/lib/api/types'
import {MEMORY_TYPE_LABEL, MEMORY_TYPE_OPTIONS} from '@/lib/memory-labels'
import {describeWorkspace} from '@/lib/workspace-state'
import {cn, formatDayLabel} from '@/lib/utils'

const MEMORY_DRAG = 'application/x-rayagent-memory'
const TYPE_ORDER: Record<MemoryType, number> = {constraint: 0, preference: 1, decision: 2, fact: 3}

const MEMORY_ORIGIN = {user: '你添加', agent_requested: '在对话中记住', auto_extraction: '自动提炼'} as const

function MemoryRow({item, workspaceId, readonly, busy, onAct}: {
  item: MemoryItem; workspaceId: string; readonly: boolean; busy: boolean
  onAct: (item: MemoryItem, action: PatchMemoryRequest) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const [type, setType] = useState<MemoryType>(item.memory_type)
  const [showSources, setShowSources] = useState(false)

  return <li id={`memory-${item.id}`} className="background-memory-row">
    <span className="background-memory-handle" draggable={!readonly && !busy && !editing}
      title={readonly ? undefined : '拖动改变钉住状态'} aria-hidden
      onDragStart={event => {
        event.dataTransfer.setData(MEMORY_DRAG, item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}><Grip className="size-4"/></span>
    <div className="min-w-0 flex-1 space-y-1">
      {editing ? <div className="space-y-2">
        <Textarea value={draft} rows={3} aria-label="记忆内容" onChange={event => setDraft(event.target.value)}/>
        <div className="flex flex-wrap gap-2">
          <Select value={type} label="记忆类型" className="mt-0 w-28"
            options={MEMORY_TYPE_OPTIONS.map(option => ({id: option.value, label: option.label}))} onChange={value => setType(value as MemoryType)}/>
          <Button size="xs" disabled={busy || !draft.trim()} onClick={() => {
            void onAct(item, {action: 'edit', version: item.version, content: draft.trim(), memory_type: type})
              .then(saved => {if (saved) setEditing(false)})
          }}>保存</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>取消</Button>
        </div>
      </div> : <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{item.content}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        {item.pinned && <span className="inline-flex items-center gap-1 rounded-[5px] bg-signal-soft px-1.5 text-signal"><Pin className="size-3"/>钉住</span>}
        <span className="rounded-[5px] bg-muted px-1.5 text-muted-foreground">{MEMORY_TYPE_LABEL[item.memory_type]}</span>
        <button type="button" aria-label={`查看来源，${MEMORY_ORIGIN[item.origin]}`} aria-expanded={showSources}
          className="rounded-sm underline-offset-2 hover:text-signal hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowSources(value => !value)}>{MEMORY_ORIGIN[item.origin]}</button>
        <span>{formatDayLabel(item.updated_at)}</span>
        <span className="tabular-nums">v{item.version}</span>
      </div>
      {showSources && <MemorySources workspaceId={workspaceId} memoryId={item.id}/>}
    </div>
    {!readonly && !editing && <div className="background-memory-actions">
      <IconAction label={item.pinned ? '取消钉住' : '钉住'} disabled={busy}
        onClick={() => void onAct(item, {action: item.pinned ? 'unpin' : 'pin', version: item.version})}>
        {item.pinned ? <PinOff/> : <Pin/>}
      </IconAction>
      <IconAction label="编辑记忆" disabled={busy} onClick={() => {setDraft(item.content); setType(item.memory_type); setEditing(true)}}><Pencil/></IconAction>
      <IconAction label="撤回记忆" disabled={busy} onClick={() => void onAct(item, {action: 'retract', version: item.version})}><X/></IconAction>
      <IconAction label="撤销变更" disabled={busy} onClick={() => void onAct(item, {action: 'undo', version: item.version})}><Undo2/></IconAction>
    </div>}
  </li>
}

function MemoryCutline({count}: {count: number}) {
  return <li className="background-memory-cutline">以下 {count} 条不常驻，任务相关时检索召回</li>
}

export type BackgroundMemorySummary = {resident: number; limit: number; pending: number}

export function MemoryPanel({workspace, onSummary}: {
  workspace: WorkspaceItem
  onSummary: (summary: BackgroundMemorySummary) => void
}) {
  const {hash} = useLocation()
  const {upsert, refresh} = useWorkspaces()
  const condition = describeWorkspace(workspace)
  const readonly = condition.archived || condition.deleting
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [residentLimit, setResidentLimit] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<{id: string; message: string} | null>(null)
  const [autoSaving, setAutoSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dropHighlight, setDropHighlight] = useState<'pinned' | 'remaining' | null>(null)
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<MemoryType>('fact')
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHitView[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const requests = useRef(0)
  const rows = useMemo(() => [...items].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || TYPE_ORDER[a.memory_type] - TYPE_ORDER[b.memory_type] ||
    (b.last_used_at ?? b.updated_at) - (a.last_used_at ?? a.updated_at)), [items])
  const active = rows.filter(item => item.status === 'active')
  const pinned = active.filter(item => item.pinned && item.resident)
  const pinnedOverflow = active.filter(item => item.pinned && !item.resident)
  const resident = active.filter(item => item.resident && !item.pinned)
  const searchable = active.filter(item => !item.resident && !item.pinned)
  const candidates = rows.filter(item => item.status === 'candidate')
  const residentCount = pinned.length + resident.length
  const pendingCount = candidates.length

  useEffect(() => {
    if (residentLimit != null) onSummary({resident: residentCount, limit: residentLimit, pending: pendingCount})
  }, [onSummary, pendingCount, residentCount, residentLimit])

  const reload = useCallback(async () => {
    const request = ++requests.current
    setLoading(true)
    setError(null)
    try {
      const data = await memoryApi.list(workspace.id, ['active', 'candidate'])
      if (request !== requests.current) return null
      setItems(data.memories)
      setResidentLimit(data.resident_limit)
      return data.memories
    } catch (reason) {
      if (request === requests.current) setError(reason instanceof Error ? reason.message : '读取记忆失败')
      return null
    } finally {if (request === requests.current) setLoading(false)}
  }, [workspace.id])

  useEffect(() => {
    void reload()
    return () => {requests.current += 1}
  }, [reload])

  useEffect(() => {
    if (hash.startsWith('#memory-') && !loading) document.getElementById(hash.slice(1))?.scrollIntoView({block: 'nearest'})
  }, [hash, loading])

  const undo = (item: MemoryItem) => ({
    label: '撤销',
    onClick: () => {
      void memoryApi.patch(workspace.id, item.id, {action: 'undo', version: item.version})
        .then(() => {void reload(); toast.success('已撤销变更')})
        .catch(reason => toast.error(reason instanceof Error ? reason.message : '撤销失败'))
    },
  })

  const toggleAutoMemory = async (enabled: boolean) => {
    if (readonly || autoSaving) return
    setAutoSaving(true)
    try {
      upsert(await instructionApi.setAutoMemory(workspace, enabled))
      toast.success(enabled ? '已开启自动记忆' : '已关闭自动记忆')
    } catch (reason) {
      reportWorkspaceError(reason, '更新自动记忆失败', () => void refresh())
    } finally {setAutoSaving(false)}
  }

  const mutate = async (item: MemoryItem, action: PatchMemoryRequest) => {
    if (busyId || readonly) return false
    setBusyId(item.id)
    setReviewError(null)
    try {
      const next = await memoryApi.patch(workspace.id, item.id, action)
      if (action.action === 'pin' || action.action === 'unpin' || action.action === 'retract') {
        toast.success(action.action === 'pin' ? '已钉住' : action.action === 'unpin' ? '已取消钉住' : '已撤回', {duration: 9000, action: undo(next)})
      } else {
        toast.success(action.action === 'confirm' ? '已确认' : action.action === 'undo' ? '已撤销变更' : '已保存')
      }
      await reload()
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '操作失败'
      if (action.action === 'confirm' && reason instanceof ApiError && reason.code === 'conflict') {
        const fresh = await reload()
        if (fresh?.some(row => row.id === item.id && row.status === 'candidate')) {
          setReviewError({id: item.id, message: '依据有变化，请对照重新读到的条目再确认。'})
        } else toast.error(message)
      } else toast.error(message)
      return false
    } finally {setBusyId(null)}
  }

  const createMemory = async () => {
    const content = newContent.trim()
    if (!content || creating || readonly) return
    setCreating(true)
    try {
      const item = await memoryApi.create(workspace.id, {content, memory_type: newType, pinned: false})
      setNewContent('')
      setAdding(false)
      toast.success('已记住', {duration: 9000, action: undo(item)})
      void reload()
    } catch (reason) {toast.error(reason instanceof Error ? reason.message : '新增失败')}
    finally {setCreating(false)}
  }

  const drop = (event: DragEvent, pin: boolean) => {
    if (!Array.from(event.dataTransfer.types).includes(MEMORY_DRAG)) return
    event.preventDefault()
    setDropHighlight(null)
    const item = active.find(row => row.id === event.dataTransfer.getData(MEMORY_DRAG))
    if (item && item.pinned !== pin) void mutate(item, {action: pin ? 'pin' : 'unpin', version: item.version})
  }
  const dragOver = (event: DragEvent, target: 'pinned' | 'remaining') => {
    if (readonly || !Array.from(event.dataTransfer.types).includes(MEMORY_DRAG)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropHighlight(target)
  }
  const renderRows = (list: MemoryItem[]) => list.map(item => <MemoryRow key={item.id} item={item} workspaceId={workspace.id}
    readonly={readonly} busy={busyId !== null} onAct={mutate}/>)

  return <section aria-label="工作区记忆" className="space-y-3" onDragEnd={() => setDropHighlight(null)}>
    <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <h2 className="text-[15px] font-semibold">记忆</h2>
      {residentLimit != null && <span className="text-xs text-faint tabular-nums">{active.length} 条</span>}
      <div className="ml-auto flex flex-wrap items-center gap-x-2">
        <label htmlFor="workspace-auto-memory" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span>任务结束后自动记住</span>
          <Switch id="workspace-auto-memory" size="sm" checked={workspace.auto_memory_enabled === true}
            disabled={readonly || autoSaving} onCheckedChange={checked => void toggleAutoMemory(checked)}/>
        </label>
        {!readonly && <IconAction label="添加记忆" aria-expanded={adding} onClick={() => setAdding(value => !value)}><Plus/></IconAction>}
      </div>
    </header>
    {loading && !items.length && <p role="status" className="text-sm text-muted-foreground">正在读取记忆…</p>}
    {error && <p role="alert" className="text-sm text-state-failed">{error} <Button size="xs" variant="ghost" onClick={() => void reload()}>重试</Button></p>}
    {adding && !readonly && <div className="space-y-2 rounded-[14px] bg-muted p-3">
      <Textarea value={newContent} rows={2} autoFocus placeholder="写下要记住的内容" aria-label="新记忆"
        disabled={creating} onChange={event => setNewContent(event.target.value)}/>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={newType} label="记忆类型" className="mt-0 w-28"
          options={MEMORY_TYPE_OPTIONS.map(option => ({id: option.value, label: option.label}))} onChange={value => setNewType(value as MemoryType)}/>
        <Button size="sm" disabled={creating || !newContent.trim()} onClick={() => void createMemory()}>记住</Button>
        <Button size="sm" variant="ghost" disabled={creating} onClick={() => setAdding(false)}>取消</Button>
      </div>
    </div>}

    {candidates.length > 0 && <ul className="space-y-2" aria-label="待确认记忆">
      {candidates.map(item => {
        const target = active.find(row => row.id === item.supersedes_id)
        return <li key={item.id} id={`memory-${item.id}`} className="background-review-card background-memory-candidate">
          <div className="flex items-center gap-2 text-xs font-medium text-state-waiting">
            <AlertTriangle className="size-4"/>{item.supersedes_id ? '这条记忆与已保存的内容不同' : '一条新记忆待确认'}
          </div>
          <div className={cn('grid gap-2.5', item.supersedes_id && 'sm:grid-cols-2')}>
            {item.supersedes_id && <div className="rounded-xl bg-muted px-3 py-2.5">
              <p className="mb-1 text-xs text-faint">已保存{target ? ` · v${target.version}` : ''}</p>
              <p className="whitespace-pre-wrap wrap-anywhere text-sm">{target?.content ?? '原条目已不可用'}</p>
            </div>}
            <div className="rounded-xl bg-state-waiting-soft px-3 py-2.5">
              <p className="mb-1 text-xs text-faint">新发现</p>
              <p className="whitespace-pre-wrap wrap-anywhere text-sm">{item.content}</p>
            </div>
          </div>
          {reviewError?.id === item.id && <p role="alert" className="text-xs text-state-waiting">{reviewError.message}</p>}
          {!readonly && <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={busyId !== null || (!!item.supersedes_id && !target)}
              aria-label={target ? `采用新的，替代 v${target.version}` : '确认记住'}
              onClick={() => void mutate(item, {action: 'confirm', version: item.version, target_version: target?.version})}>
              {item.supersedes_id ? '采用新的' : '确认记住'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busyId !== null}
              onClick={() => void mutate(item, {action: 'retract', version: item.version})}>
              {target ? '保留原来的' : '撤回候选'}
            </Button>
          </div>}
        </li>
      })}
    </ul>}

    {residentLimit != null && <>
      <div className="background-memory-lane" data-over={dropHighlight === 'pinned'}
        onDragOver={event => dragOver(event, 'pinned')} onDrop={event => drop(event, true)}
        onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropHighlight(null)}}>
        <div className="background-memory-lane-title">
          <h3>钉住</h3><span>优先随新任务带上</span>
          <span className="ml-auto tabular-nums">{pinned.length + pinnedOverflow.length} 条</span>
        </div>
        <div className="background-memory-drop-slot" aria-hidden/>
        {pinned.length || pinnedOverflow.length ? <ul>
          {renderRows(pinned)}
          {pinnedOverflow.length > 0 && <MemoryCutline count={pinnedOverflow.length}/>}
          {renderRows(pinnedOverflow)}
        </ul> : <p className="px-4 py-4 text-xs text-faint">{readonly ? '暂无钉住的记忆' : '把常用的记忆拖到这里'}</p>}
      </div>

      <div className="background-memory-lane" data-over={dropHighlight === 'remaining'}
        onDragOver={event => dragOver(event, 'remaining')} onDrop={event => drop(event, false)}
        onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropHighlight(null)}}>
        <div className="background-memory-lane-title">
          <h3>其余</h3><span>按约束、偏好、决定、事实排列，同类最近使用优先</span>
        </div>
        <div className="background-memory-drop-slot" aria-hidden/>
        {resident.length || searchable.length ? <ul>
          {renderRows(resident)}
          {searchable.length > 0 && <MemoryCutline count={searchable.length}/>}
          {renderRows(searchable)}
        </ul> : <p className="px-4 py-4 text-xs text-faint">暂无其他记忆</p>}
      </div>
    </>}

    <details className="pt-1">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">检索现有材料</summary>
      <form className="mt-3 flex gap-2" onSubmit={event => {
        event.preventDefault()
        if (searching || !searchQuery.trim()) return
        setSearching(true)
        setSearchError(null)
        void memoryApi.search(workspace.id, {query: searchQuery.trim(), limit: 20}).then(result => setSearchHits(result.hits))
          .catch(reason => setSearchError(reason instanceof Error ? reason.message : '检索失败')).finally(() => setSearching(false))
      }}>
        <Input value={searchQuery} placeholder="检索记忆与对话摘要" aria-label="检索内容" onChange={event => setSearchQuery(event.target.value)}/>
        <Button type="submit" size="icon-sm" variant="secondary" disabled={searching || !searchQuery.trim()} aria-label="检索">
          {searching ? <Loader2 className="animate-spin"/> : <Search/>}
        </Button>
      </form>
      {searchError && <p role="alert" className="mt-2 text-sm text-state-failed">{searchError}</p>}
      {searchHits != null && <ul className="mt-2 space-y-2">
        {searchHits.length === 0 && <li className="text-sm text-muted-foreground">没有命中</li>}
        {searchHits.map(hit => <li key={`${hit.source_type}:${hit.source_id}`} className="rounded-md bg-background p-2 text-sm">
          <strong>{hit.title || '来源片段'}</strong>{hit.stale && <span className="ml-2 text-xs text-state-waiting">已过期</span>}
          <p className="wrap-anywhere text-muted-foreground">{hit.snippet}</p>
        </li>)}
      </ul>}
    </details>
  </section>
}
