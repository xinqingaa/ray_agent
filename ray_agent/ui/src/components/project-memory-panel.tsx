'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import Link from 'next/link'
import {CircleHelp, Eye, History, X} from 'lucide-react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectAuditEvent, ProjectDetails, ProjectMemorySummary, ProjectMemoryView} from '@/lib/api/types'
import {ProjectSummaryDialog} from '@/components/project-summary-dialog'
import {cn} from '@/lib/utils'

type Section = 'instructions' | 'notes' | 'summaries'
type Overlay = 'history' | 'preview' | null
const sections: Array<[Section, string]> = [['instructions', '说明'], ['notes', '笔记'], ['summaries', '摘要']]

export function ProjectMemoryPanel({projectId, sessionId, open, onClose, onChanged}: {projectId: string; sessionId?: string; open: boolean; onClose: () => void; onChanged?: () => void}) {
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [memory, setMemory] = useState<ProjectMemoryView | null>(null)
  const [section, setSection] = useState<Section>('instructions')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<ProjectAuditEvent[]>([])
  const [more, setMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [summary, setSummary] = useState<{id: string; title: string} | null>(null)
  const [restore, setRestore] = useState<string | null>(null)
  const dirty = useRef(false)
  const epoch = useRef(0)
  const historyEpoch = useRef(0)
  const estimateEpoch = useRef(0)

  const refresh = useCallback(async () => {
    const token = ++epoch.current
    try {
      const [p, m] = await Promise.all([projectApi.detail(projectId), projectApi.memory(projectId, sessionId)])
      if (token === epoch.current) {
        setProject(p)
        setMemory(old => ({...m, capacity: old?.project_prompt === m.project_prompt ? old.capacity : undefined}))
        setError(null)
      }
    } catch (err) {
      if (token === epoch.current) setError(err instanceof Error ? err.message : '读取项目记忆失败')
    }
  }, [projectId, sessionId])

  useEffect(() => {
    if (!open) return
    setProject(null)
    setMemory(null)
    setError(null)
    setHistory([])
    setOverlay(null)
    setSection('instructions')
    dirty.current = false
    void refresh()
    const visible = () => {if (document.visibilityState !== 'hidden' && !dirty.current) void refresh()}
    let timer: number | undefined
    const unsubscribe = subscribeCatalog((hint) => {
      if (hint.kind !== 'project' || hint.id !== projectId || dirty.current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(visible, 300)
    })
    window.addEventListener('focus', visible)
    const counter = epoch
    const historyCounter = historyEpoch
    const estimateCounter = estimateEpoch
    return () => {counter.current++; historyCounter.current++; estimateCounter.current++; setEstimating(false); window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', visible)}
  }, [open, projectId, refresh])

  useUnsavedNavigation(() => dirty.current, open)
  const leave = () => {if (!dirty.current || window.confirm('项目记忆有未保存的修改，放弃修改并关闭？')) onClose()}

  const changeSection = (next: Section) => {
    if (next === section && overlay === null) return
    if (next !== section && dirty.current && !window.confirm('放弃当前未保存的修改并切换分区？')) return
    if (next !== section) {dirty.current = false; setRestore(null)}
    setSection(next)
    setOverlay(null)
  }

  const loadHistory = async (append = false) => {
    const token = ++historyEpoch.current
    setHistoryLoading(true)
    try {
      const rows = await projectApi.memoryHistory(projectId, append ? history.at(-1)?.seq || 0 : 0)
      if (token === historyEpoch.current) {setHistory(old => append ? [...old, ...rows] : rows); setMore(rows.length === 20); setError(null)}
    } catch (err) {
      if (token === historyEpoch.current) setError(err instanceof Error ? err.message : '读取修改记录失败')
    } finally {
      if (token === historyEpoch.current) setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (open && overlay === 'history') void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, overlay, projectId])

  const changed = () => {void refresh(); onChanged?.()}
  const toggleOverlay = (next: Exclude<Overlay, null>) => setOverlay(old => old === next ? null : next)

  return (
    <Sheet open={open} onOpenChange={value => {if (!value) leave()}}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <SheetHeader className="shrink-0 gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-1">
            <SheetTitle className="min-w-0 flex-1 truncate text-sm font-medium">
              项目记忆
              {project && <span className="ml-2 font-normal text-muted-foreground">{project.name}</span>}
            </SheetTitle>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="项目记忆说明" title="说明"><CircleHelp/></Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="z-[70] w-64 space-y-1.5 p-3 text-xs leading-5 text-muted-foreground">
                <p>说明：之后每次新对话都会带上。</p>
                <p>笔记：你和 Agent 一起改。</p>
                <p>摘要：只带最近几段，有字数上限。</p>
                {memory?.frozen && <p>这次续接仍用原版本。</p>}
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon-sm" className={cn('text-muted-foreground', overlay === 'history' && 'bg-muted text-foreground')} aria-pressed={overlay === 'history'} aria-label="修改记录" title="修改记录" onClick={() => toggleOverlay('history')}><History/></Button>
            <Button variant="ghost" size="icon-sm" className={cn('text-muted-foreground', overlay === 'preview' && 'bg-muted text-foreground')} aria-pressed={overlay === 'preview'} aria-label="运行内容预览" title="运行内容预览" onClick={() => toggleOverlay('preview')}><Eye/></Button>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="关闭项目记忆" onClick={leave}><X/></Button>
          </div>
          <div role="tablist" aria-label="项目记忆分区" className="flex min-h-8 rounded-full bg-muted p-0.5">
            {sections.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`memory-tab-${id}`} tabIndex={section === id ? 0 : -1} aria-selected={section === id && overlay === null}
                onKeyDown={event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault(); const index = sections.findIndex(([key]) => key === section); const next = sections[event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + sections.length) % sections.length][0]; changeSection(next); document.getElementById(`memory-tab-${next}`)?.focus()}}}
                onClick={() => changeSection(id)}
                className={cn('flex-1 rounded-full text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring', section === id && overlay === null ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground')}>
                {label}
              </button>
            ))}
          </div>
          <SheetDescription className="sr-only">项目说明、笔记和近期摘要</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error && <div role="alert" className="mb-3 text-meta text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重新读取</Button></div>}
          {!project && !error && <p className="text-meta text-faint">正在读取</p>}
          {project && overlay === null && (section === 'instructions' || section === 'notes') && (
            <MemoryEditor key={`${projectId}:${section}:${restore ?? 'live'}`} field={section} project={project} restored={restore} onDirty={value => {dirty.current = value}} onSaved={changed}/>
          )}
          {overlay === null && section === 'summaries' && memory && (
            <div>
              {!memory.candidates.length && <p className="py-8 text-sm text-faint">还没有摘要</p>}
              {memory.candidates.map(item => {
                const included = memory.project.summaries.find(value => value.session_id === item.session_id)
                const status = summaryStatus(item, included)
                return (
                  <article key={item.session_id} className="group/summary border-b py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/sessions/${item.session_id}`} className="min-w-0 flex-1 truncate text-sm">{item.title || '项目对话'}</Link>
                      {status && <span className={cn('shrink-0 text-xs', item.state === 'failed' ? 'text-state-failed' : 'text-faint')}>{status}</span>}
                      <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground opacity-0 group-hover/summary:opacity-100 focus-visible:opacity-100 max-md:opacity-100" onClick={() => setSummary({id: item.session_id, title: item.title})}>改写</Button>
                    </div>
                    {item.summary && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.summary}</p>}
                    {item.error && <p className="mt-1 text-xs text-state-failed">{item.error}</p>}
                  </article>
                )
              })}
            </div>
          )}
          {overlay === 'history' && (
            <div className="space-y-1">
              {history.map(event => (
                <details key={event.seq} className="border-b py-2">
                  <summary className="cursor-pointer text-sm">{historyLabel(event.type)} · {new Date(event.created_at).toLocaleString()}</summary>
                  <p className="mt-2 text-xs text-faint">{historySource(event)}{event.payload.notes_version != null && ` · 版本 ${event.payload.notes_version}`}</p>
                  {typeof event.payload.session_id === 'string' && <Link className="mt-1 block text-xs text-signal underline" href={`/sessions/${event.payload.session_id}`}>打开来源对话</Link>}
                  {!!event.payload.auxiliary && typeof event.payload.auxiliary === 'object' && <p className="mt-1 text-xs text-faint">{auxiliaryLine(event.payload.auxiliary as Record<string, unknown>)}</p>}
                  <pre className="my-2 whitespace-pre-wrap break-words text-sm">{String(event.payload.content ?? event.payload.instructions ?? event.payload.summary ?? event.payload.error ?? event.payload.reason ?? '')}</pre>
                  {event.type === 'project_notes' && typeof event.payload.content === 'string' && (
                    <Button size="sm" variant="outline" title="取回为笔记草稿。文件恢复不会改这里。" onClick={() => {
                      if (dirty.current && !window.confirm('放弃当前未保存的修改并取回这条笔记？')) return
                      setRestore(String(event.payload.content))
                      setSection('notes')
                      setOverlay(null)
                    }}>取回到笔记</Button>
                  )}
                </details>
              ))}
              {historyLoading && <p role="status" className="text-meta text-faint">正在读取修改记录</p>}
              {!historyLoading && !history.length && <p className="py-8 text-sm text-faint">还没有修改记录</p>}
              {more && <Button variant="outline" size="sm" onClick={() => void loadHistory(true)}>加载更早记录</Button>}
            </div>
          )}
          {overlay === 'preview' && memory && (
            <div className="space-y-3">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{memory.project_prompt || '还没有会注入的项目内容'}</pre>
              {memory.frozen && (
                <details>
                  <summary className="cursor-pointer text-sm">这次运行仍用原版本</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{memory.frozen.instructions || '未设置说明'}{'\n\n'}{memory.frozen.notes || '未设置笔记'}</pre>
                </details>
              )}
              <Button variant="outline" size="sm" disabled={estimating} onClick={async () => {
                const token = ++estimateEpoch.current
                setEstimating(true)
                try {
                  const result = await projectApi.estimateMemory(projectId, sessionId)
                  if (token === estimateEpoch.current) {setMemory(result); setError(null)}
                } catch (err) {
                  if (token === estimateEpoch.current) setError(err instanceof Error ? err.message : '估算失败')
                } finally {
                  if (token === estimateEpoch.current) setEstimating(false)
                }
              }}>{estimating ? '正在估算' : '估算容量'}</Button>
              {memory.capacity && (
                <div role="status" className="space-y-1 text-meta">
                  <p>{memory.capacity.model} · {memory.capacity.total} / {memory.capacity.limit} tokens</p>
                  <p className="text-faint">系统内容 {memory.capacity.system_prompt}，工具 {memory.capacity.tools}（{memory.capacity.tool_count} 个）</p>
                  {memory.capacity.over_limit && <p className="text-state-failed">固定内容已超限。请精简说明或笔记后重新估算。</p>}
                  {Object.entries(memory.capacity.discovery_errors).map(([name, message]) => <p className="text-state-waiting" key={name}>{name}：{message}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
        <ProjectSummaryDialog sessionId={summary?.id || null} title={summary?.title || ''} onClose={() => setSummary(null)} onChanged={changed}/>
      </SheetContent>
    </Sheet>
  )
}

function summaryStatus(item: ProjectMemorySummary, included: ProjectMemorySummary | undefined) {
  if (item.state === 'failed') return '生成失败'
  if (item.state === 'generating') return '正在生成'
  if (!included) return '未纳入'
  if (item.stale) return '可能过时'
  if (included.truncated) return '部分纳入'
  return null
}

function historyLabel(type: string) {
  if (type === 'project_notes') return '笔记'
  if (type === 'project_settings') return '说明'
  if (type === 'conversation_summary') return '摘要'
  return '摘要生成'
}

function historySource(event: ProjectAuditEvent) {
  if (event.payload.source === 'agent') return 'Agent'
  if (event.payload.source === 'user' || event.payload.source === 'manual') return '用户'
  return '自动生成'
}

function auxiliaryLine(auxiliary: Record<string, unknown>) {
  const model = String(auxiliary.model || '模型未记录')
  const duration = String(auxiliary.duration_ms ?? '未知')
  const usage = auxiliary.usage ? JSON.stringify(auxiliary.usage) : '用量未知'
  return `${model} · ${duration} ms · ${usage}`
}

function MemoryEditor({field, project, restored, onDirty, onSaved}: {field: 'instructions' | 'notes'; project: ProjectDetails; restored: string | null; onDirty: (value: boolean) => void; onSaved: () => void}) {
  const current = field === 'notes' ? project.notes : project.instructions || ''
  const version = field === 'notes' ? project.notes_version : project.settings_version
  const [draft, setDraft] = useState(restored ?? current)
  const [base, setBase] = useState(version)
  const [original, setOriginal] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState<{text: string; version: number} | null>(null)
  const alive = useRef(true)
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const placeholder = field === 'notes' ? '结论、决定、文件位置' : '之后每次都要遵守的要求'

  useEffect(() => {alive.current = true; return () => {alive.current = false}}, [])
  const dirty = draft !== original
  useEffect(() => {onDirtyRef.current(dirty)}, [dirty])
  useEffect(() => {
    if (conflict || draft !== original) return
    if (version !== base) {setDraft(current); setOriginal(current); setBase(version)}
  }, [current, version, conflict, draft, original, base])

  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      if (field === 'notes') await projectApi.updateNotes(project.id, draft, base)
      else await projectApi.update(project.id, {name: project.name, instructions: draft || null, settings_version: base})
      if (alive.current) {setOriginal(draft); setSaved(true); setConflict(null); onDirtyRef.current(false); onSaved()}
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : '保存失败，草稿已保留')
        if (err instanceof ApiError && err.code === 409) {
          const latest = await projectApi.detail(project.id).catch(() => null)
          if (alive.current && latest) setConflict({text: field === 'notes' ? latest.notes : latest.instructions || '', version: field === 'notes' ? latest.notes_version : latest.settings_version})
        }
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section className="flex min-h-[50vh] flex-col gap-3">
      <label className="sr-only" htmlFor={`memory-${field}`}>{field === 'notes' ? '项目笔记' : '项目说明'}</label>
      <textarea id={`memory-${field}`} disabled={busy} maxLength={8000} placeholder={placeholder} className="min-h-[45vh] w-full flex-1 resize-none rounded-md border bg-background p-3 text-sm leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft} onChange={event => {setDraft(event.target.value); setSaved(false)}}/>
      <div className="flex items-center gap-3">
        <p className="text-xs tabular-nums text-faint">{draft.length} / 8000</p>
        <Button className="ml-auto" size="sm" disabled={busy || !dirty || !!conflict} onClick={() => void save()}>{busy ? '正在保存' : '保存'}</Button>
      </div>
      {conflict && (
        <div className="space-y-3 rounded-md border border-state-waiting p-3">
          <p className="text-meta">最新版本 {conflict.version}，草稿已保留。</p>
          <details><summary className="cursor-pointer text-meta">编辑前的内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{original}</pre></details>
          <details open><summary className="cursor-pointer text-meta">最新内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{conflict.text || '（空）'}</pre></details>
          <Button size="sm" variant="outline" onClick={() => {setBase(conflict.version); setOriginal(conflict.text); setConflict(null); setError(null)}}>按最新版本继续</Button>
        </div>
      )}
      {saved && !dirty && <p role="status" className="text-meta text-state-success">已保存，下一次新运行生效。</p>}
      {error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
    </section>
  )
}
