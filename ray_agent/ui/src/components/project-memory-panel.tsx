'use client'

import {useCallback, useEffect, useId, useRef, useState, type ReactNode} from 'react'
import Link from 'next/link'
import {ArrowLeft, FileText, History, NotebookPen, Pencil, RefreshCw, ScrollText, X} from 'lucide-react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {MarkdownContent} from '@/components/markdown-content'
import {ProjectSummaryList} from '@/components/project-summary-list'
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectAuditEvent, ProjectDetails, ProjectMemorySummary, ProjectMemoryView, Session} from '@/lib/api/types'
import {ProjectSummaryDialog} from '@/components/project-summary-dialog'

type Section = 'instructions' | 'notes' | 'summaries'
type Overlay = 'history' | null
const sections = [{value: 'instructions' as const, label: '说明', icon: FileText}, {value: 'notes' as const, label: '笔记', icon: NotebookPen}, {value: 'summaries' as const, label: '摘要', icon: ScrollText}]

export function ProjectMemoryPanel({projectId, sessionId, open, initialSection = 'instructions', initialOverlay = null, onClose, onChanged, fallbackFocus}: {fallbackFocus?:()=>void; initialSection?: Section; initialOverlay?: Overlay; projectId: string; sessionId?: string; open: boolean; onClose: () => void; onChanged?: () => void}) {
  const {visibility} = useDeveloperMode()
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [memory, setMemory] = useState<ProjectMemoryView | null>(null)
  const [candidates, setCandidates] = useState<ProjectMemorySummary[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [section, setSection] = useState<Section>('instructions')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<ProjectAuditEvent[]>([])
  const [more, setMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [summary, setSummary] = useState<{id: string; title: string} | null>(null)
  const [summaryBusy,setSummaryBusy]=useState(false)
  const [restore, setRestore] = useState<string | null>(null)
  const panelContent = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dirty = useRef(false)
  const epoch = useRef(0)
  const historyEpoch = useRef(0)

  const refresh = useCallback(async () => {
    const token = ++epoch.current
    try {
      const [p, m, all, conversations] = await Promise.all([projectApi.detail(projectId), projectApi.memory(projectId, sessionId), projectApi.memory(projectId), projectApi.sessions(projectId)])
      if (token === epoch.current) {
        setProject(p)
        setCandidates(all.candidates)
        setSessions(conversations.sessions)
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
    setSummary(null)
    setMemory(null)
    setCandidates([])
    setSessions([])
    setError(null)
    setHistory([])
    setOverlay(initialOverlay)
    setSection(initialSection)
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
    return () => {counter.current++; historyCounter.current++; window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', visible)}
  }, [open, projectId, refresh, initialSection, initialOverlay])

  useUnsavedNavigation(() => dirty.current || summaryBusy, open)
  const leave = () => {if(summaryBusy)return;if (!dirty.current || window.confirm('项目记忆有未保存的修改，放弃修改并关闭？')) onClose()}

  const changeSection = (next: Section) => {
    if (next === section && overlay === null) return
    if (next !== section && dirty.current && !window.confirm('放弃当前未保存的修改并切换分区？')) return
    if (next !== section) {dirty.current = false; setRestore(null)}
    setSection(next)
    setSummary(null)
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
      <SheetContent ref={panelContent} onOpenAutoFocus={event=>{returnFocus.current=document.activeElement instanceof HTMLElement ? document.activeElement : null;event.preventDefault();panelContent.current?.focus()}} onCloseAutoFocus={event=>{if(returnFocus.current?.isConnected){event.preventDefault();returnFocus.current.focus({preventScroll:true})}else if(fallbackFocus){event.preventDefault();fallbackFocus()}}} showCloseButton={false} className="w-full gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <SheetHeader className="shrink-0 gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-2"><SheetTitle className="shrink-0 text-sm font-medium">项目记忆</SheetTitle><p className="truncate text-xs text-muted-foreground">{project?.name || '正在读取'}</p></div>
            {overlay === 'history' && <IconAction label="刷新修改记录" disabled={historyLoading} onClick={()=>void loadHistory()}><RefreshCw/></IconAction>}
            <IconAction label="关闭项目记忆" disabled={summaryBusy} className="text-muted-foreground" onClick={leave}><X/></IconAction>
          </div>
          <div className="flex items-center gap-2">
            {overlay || summary ? <><IconAction label={`返回${sections.find(item=>item.value===section)?.label}`} disabled={summaryBusy} onClick={()=>{if(summary && dirty.current && !window.confirm('放弃未保存的摘要修改？'))return;if(summary)dirty.current=false;setSummary(null);setOverlay(null)}}><ArrowLeft/></IconAction><span className="min-w-0 flex-1 text-meta font-medium">{summary ? '编辑摘要' : '修改记录'}</span></> : <><SegmentedControl className="min-w-0 flex-1" value={section} onValueChange={changeSection} options={sections} label="项目记忆分区"/>{section === 'summaries' && <IconAction label="查看修改记录" onClick={()=>toggleOverlay('history')}><History/></IconAction>}</>}
          </div>
          <SheetDescription className="sr-only">项目说明、笔记和近期摘要</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error && <div role="alert" className="mb-3 text-meta text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => void refresh()}>重新读取</Button></div>}
          {!project && !error && <p className="text-meta text-faint">正在读取</p>}
          {project && (section === 'instructions' || section === 'notes') && <div hidden={overlay !== null || summary !== null}>
            <MemoryEditor key={`${projectId}:${section}:${restore ?? 'live'}`} toolbar={<><p className="mr-auto text-xs text-muted-foreground">{section === 'notes' ? '背景与结论' : '后续对话遵守的要求'}</p><IconAction label="查看修改记录" onClick={()=>toggleOverlay('history')}><History/></IconAction></>} field={section} project={project} restored={restore} onDirty={value => {dirty.current = value}} onSaved={changed}/>
          </div>}
          {!summary && overlay === null && section === 'summaries' && memory && (
            <div>
              <ProjectSummaryList candidates={candidates} sessions={sessions} onEdit={setSummary}/>
            </div>
          )}
          {overlay === 'history' && (
            <div className="space-y-1">
              {history.map(event => (
                <details key={event.seq} className="border-b py-2">
                  <summary className="cursor-pointer text-sm">{historyLabel(event.type)} · {new Date(event.created_at).toLocaleString()}</summary>
                  <p className="mt-2 text-xs text-faint">{historySource(event)}{visibility.memoryInternals && event.payload.notes_version != null && ` · 版本 ${event.payload.notes_version}`}</p>
                  {typeof event.payload.session_id === 'string' && <Link className="mt-1 block text-xs text-signal underline" href={`/sessions/${event.payload.session_id}`}>打开来源对话</Link>}
                  {visibility.memoryInternals && !!event.payload.auxiliary && typeof event.payload.auxiliary === 'object' && <p className="mt-1 text-xs text-faint">{auxiliaryLine(event.payload.auxiliary as Record<string, unknown>)}</p>}
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
          {summary && <ProjectSummaryDialog embedded onBusy={setSummaryBusy} sessionId={summary.id} title={summary.title} onDirty={value=>{dirty.current=value}} onClose={()=>setSummary(null)} onChanged={changed}/>}
        </div>
      </SheetContent>
    </Sheet>
  )
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

export function MemoryEditor({field, project, restored, onDirty, onSaved, toolbar}: {field: 'instructions' | 'notes'; project: ProjectDetails; restored: string | null; onDirty: (value: boolean) => void; onSaved: () => void; toolbar?: ReactNode}) {
  const editorId = useId()
  const {visibility} = useDeveloperMode()
  const current = field === 'notes' ? project.notes : project.instructions || ''
  const version = field === 'notes' ? project.notes_version : project.settings_version
  const [draft, setDraft] = useState(restored ?? current)
  const [base, setBase] = useState(version)
  const [original, setOriginal] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(restored !== null)
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
      if (alive.current) {setOriginal(draft); setSaved(true); setEditing(false); setConflict(null); onDirtyRef.current(false); onSaved()}
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
      {toolbar ? <div className="flex min-h-8 items-center gap-1 border-b pb-3">{toolbar}<IconAction label={field === 'notes' ? '编辑笔记' : '编辑说明'} disabled={editing || !!project.file_operation || project.archived} onClick={() => setEditing(true)}><Pencil/></IconAction></div> : !editing && current && <div className="flex justify-end"><IconAction label={field === 'notes' ? '编辑笔记' : '编辑说明'} onClick={() => setEditing(true)}><Pencil/></IconAction></div>}
      {editing && visibility.memoryInternals && <p className="text-xs text-faint">版本 {version}</p>}
      <label className="sr-only" htmlFor={editorId}>{field === 'notes' ? '项目笔记' : '项目说明'}</label>
      {editing ? <>
      <textarea id={editorId} disabled={busy} maxLength={8000} placeholder={placeholder} className="min-h-[45vh] w-full flex-1 resize-none rounded-md border bg-background p-3 text-sm leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft} onChange={event => {setDraft(event.target.value); setSaved(false)}}/>
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-card py-3">
        <p className="text-xs tabular-nums text-faint">{draft.length} / 8000</p>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => {if (!dirty || window.confirm('放弃未保存的修改？')) {setDraft(original); setConflict(null); setError(null); setEditing(false); onDirtyRef.current(false)}}}>取消</Button>
        <Button size="sm" disabled={busy || !dirty || !!conflict} onClick={() => void save()}>{busy ? '正在保存' : '保存'}</Button>
      </div>
      </> : current ? <MarkdownContent content={current}/> : toolbar ? <p className="py-5 text-sm text-muted-foreground">{field === 'notes' ? '尚无笔记。' : '尚未设置项目说明。'}点击右上角编辑开始添加。</p> : <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => setEditing(true)}><Pencil className="size-3.5"/>{field === 'notes' ? '添加笔记' : '添加说明'}</Button>}
      {conflict && (
        <div className="space-y-3 rounded-md border border-state-waiting p-3">
          <p className="text-meta">{visibility.memoryInternals ? `最新版本 ${conflict.version}` : '内容已被更新'}，草稿已保留。</p>
          <details><summary className="cursor-pointer text-meta">编辑前的内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{original}</pre></details>
          <details open><summary className="cursor-pointer text-meta">最新内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{conflict.text || '（空）'}</pre></details>
          <Button size="sm" variant="outline" onClick={() => {setBase(conflict.version); setOriginal(conflict.text); setConflict(null); setError(null)}}>按最新版本继续</Button>
        </div>
      )}
      {saved && !dirty && <p role="status" className="text-meta text-state-success">已保存</p>}
      {error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
    </section>
  )
}
