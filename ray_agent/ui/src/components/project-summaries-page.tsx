'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {ArrowLeft, RefreshCw} from 'lucide-react'
import {projectApi} from '@/lib/api/project'
import type {ProjectMemorySummary, Session} from '@/lib/api/types'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {ProjectSummaryList} from './project-summary-list'
import {ProjectSummaryDialog} from './project-summary-dialog'
import {IconAction} from './ui/icon-action'

export function ProjectSummariesPage({projectId, onChanged}: {projectId: string; onChanged: () => void}) {
  const [data, setData] = useState<{candidates: ProjectMemorySummary[]; sessions: Session[]} | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{id: string; title: string} | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)
  const epoch = useRef(0)
  useUnsavedNavigation(() => dirty.current || busy)
  const refresh = useCallback(async () => {
    const token = ++epoch.current
    setLoading(true)
    try {
      const [memory, conversations] = await Promise.all([projectApi.memory(projectId), projectApi.sessions(projectId)])
      if (token === epoch.current) {setData({candidates: memory.candidates, sessions: conversations.sessions}); setError(null)}
    } catch (err) {if (token === epoch.current) setError(err instanceof Error ? err.message : '读取摘要失败')}
    finally {if (token === epoch.current) setLoading(false)}
  }, [projectId])
  useEffect(() => {
    void refresh()
    const unsubscribe = subscribeCatalog(hint => {if (hint.kind === 'project' && hint.id === projectId && !dirty.current) void refresh()})
    const counter = epoch
    return () => {counter.current++; unsubscribe()}
  }, [projectId, refresh])
  const back = () => {
    if (busy || (dirty.current && !window.confirm('放弃未保存的摘要修改？'))) return
    dirty.current = false
    setEditing(null)
  }
  return <section className="max-w-4xl">
    <div className="mb-3 flex min-h-8 items-center gap-2">
      {editing && <IconAction label="返回摘要列表" disabled={busy} onClick={back}><ArrowLeft/></IconAction>}
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{editing ? '编辑摘要' : '保留对话要点，供后续任务参考'}</p>
      {!editing && <IconAction label="刷新摘要" disabled={loading} onClick={()=>void refresh()}><RefreshCw/></IconAction>}
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-state-failed">{error}</p>}
    {!data && loading && <p role="status" className="py-5 text-sm text-muted-foreground">正在读取摘要</p>}
    {editing ? <ProjectSummaryDialog embedded sessionId={editing.id} title={editing.title} onBusy={setBusy} onDirty={value=>{dirty.current=value}} onClose={()=>{dirty.current=false;setEditing(null)}} onChanged={()=>{void refresh();onChanged()}}/> : data && <ProjectSummaryList {...data} onEdit={setEditing}/>}
  </section>
}
