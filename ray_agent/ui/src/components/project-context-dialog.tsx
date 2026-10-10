'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import Link from 'next/link'
import {projectApi} from '@/lib/api/project'
import type {ProjectMemorySnapshot, ProjectMemoryView} from '@/lib/api/types'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog'
import {OverlayToolbar} from './ui/overlay-toolbar'
import {Button} from './ui/button'
import {MarkdownContent} from './markdown-content'

export function ProjectContextDialog({projectId, sessionId, open, onClose, onReturnFocus}: {projectId: string; sessionId?: string; open: boolean; onClose: () => void; onReturnFocus?: () => void}) {
  const {visibility} = useDeveloperMode()
  const [memory, setMemory] = useState<ProjectMemoryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const epoch = useRef(0)
  const refresh = useCallback(async (estimate = false) => {
    const token = ++epoch.current
    setLoading(true)
    try {
      const result = estimate ? await projectApi.estimateMemory(projectId, sessionId) : await projectApi.memory(projectId, sessionId)
      if (token === epoch.current) {setMemory(result);setError(null)}
    } catch (err) {if (token === epoch.current) setError(err instanceof Error ? err.message : '读取项目上下文失败')}
    finally {if (token === epoch.current) setLoading(false)}
  }, [projectId, sessionId])
  useEffect(() => {
    if (!open || !visibility.memoryInternals) return
    setMemory(null);setError(null);void refresh()
    const counter = epoch
    return () => {counter.current++}
  }, [open, visibility.memoryInternals, refresh])
  useEffect(()=>{if(open && !visibility.memoryInternals)onClose()},[open,visibility.memoryInternals,onClose])
  return <Dialog open={open && visibility.memoryInternals} onOpenChange={value=>{if(!value)onClose()}}>
    <DialogContent ref={content} showCloseButton={false} onOpenAutoFocus={event=>{event.preventDefault();content.current?.focus()}} onCloseAutoFocus={event=>{if(onReturnFocus){event.preventDefault();onReturnFocus()}}} className="flex h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <OverlayToolbar title={<DialogTitle className="truncate text-sm font-medium">项目上下文预览</DialogTitle>} onRefresh={()=>void refresh()} refreshLabel="刷新项目上下文" refreshing={loading} onClose={onClose}/>
      <DialogDescription className="sr-only">当前项目组合与活动运行快照</DialogDescription>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {error && <p role="alert" className="mb-3 text-sm text-state-failed">{error}</p>}
        {!memory && loading && <p role="status" className="text-sm text-muted-foreground">正在读取项目上下文</p>}
        {memory && <div className="space-y-6">
          <section><h3 className="mb-3 text-sm font-semibold">当前组合</h3><SnapshotContent snapshot={memory.project}/></section>
          <section className="border-t pt-4"><h3 className="mb-2 text-sm font-semibold">活动运行快照</h3>
            {memory.frozen ? <><p className="mb-3 text-meta text-muted-foreground">来源对话：{memory.occupying_session_id ? <Link className="text-signal underline" href={`/sessions/${memory.occupying_session_id}`}>打开来源对话</Link> : '未取得来源'}{sessionId && memory.occupying_session_id && sessionId !== memory.occupying_session_id && '（其他对话）'}</p><SnapshotContent snapshot={memory.frozen}/></> : <p className="text-meta text-faint">当前没有活动运行快照。</p>}
          </section>
          <details className="border-t pt-4"><summary className="cursor-pointer text-meta">项目上下文原文</summary><pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6">{memory.project_prompt}</pre></details>
          <Button size="sm" variant="outline" disabled={loading} onClick={()=>void refresh(true)}>估算容量</Button>
          {memory.capacity && <div role="status" className="space-y-1 text-meta"><p>{memory.capacity.model} · {memory.capacity.total} / {memory.capacity.limit} tokens（估算）</p><p className="text-faint">系统内容 {memory.capacity.system_prompt}，工具 {memory.capacity.tools}（{memory.capacity.tool_count} 个）</p>{memory.capacity.over_limit && <p className="text-state-failed">固定内容已超限。请精简说明或笔记后重新估算。</p>}{Object.entries(memory.capacity.discovery_errors).map(([name,message])=><p key={name} className="text-state-waiting">{name}：{message}</p>)}</div>}
        </div>}
      </div>
    </DialogContent>
  </Dialog>
}

function SnapshotContent({snapshot}: {snapshot: ProjectMemorySnapshot}) {
  return <div className="space-y-4">{[['项目说明',snapshot.instructions],['项目笔记',snapshot.notes]].map(([label,text])=><section key={label}><h4 className="mb-2 text-meta font-medium">{label}</h4>{text ? <MarkdownContent content={text}/> : <p className="text-meta text-faint">未设置</p>}</section>)}<section><h4 className="mb-2 text-meta font-medium">选入的对话摘要 · {snapshot.summaries.length}</h4>{snapshot.summaries.length ? snapshot.summaries.map(item=><div key={item.session_id} className="border-t py-3"><Link href={`/sessions/${item.session_id}`} className="text-meta font-medium text-signal">{item.title || '来源对话'}</Link>{item.truncated && <p className="mt-1 text-xs text-faint">部分纳入</p>}<div className="mt-2"><MarkdownContent content={item.truncated && item.injected_text ? item.injected_text : item.summary}/></div></div>) : <p className="text-meta text-faint">未选入摘要</p>}</section></div>
}
