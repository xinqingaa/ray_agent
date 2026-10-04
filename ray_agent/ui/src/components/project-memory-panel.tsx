'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import Link from 'next/link'
import {BookOpen, X} from 'lucide-react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectAuditEvent, ProjectDetails, ProjectMemoryView} from '@/lib/api/types'
import {ProjectSummaryDialog} from '@/components/project-summary-dialog'

type Section = 'instructions' | 'notes' | 'summaries' | 'history' | 'preview'
const sections: Array<[Section, string]> = [['instructions','项目说明'],['notes','项目笔记'],['summaries','近期摘要'],['history','修改记录'],['preview','运行内容预览']]

export function ProjectMemoryPanel({projectId, sessionId, open, onClose, onChanged}: {projectId: string; sessionId?: string; open: boolean; onClose: () => void; onChanged?: () => void}) {
  const [project,setProject]=useState<ProjectDetails | null>(null)
  const [memory,setMemory]=useState<ProjectMemoryView | null>(null)
  const [section,setSection]=useState<Section>('instructions')
  const [error,setError]=useState<string | null>(null)
  const [history,setHistory]=useState<ProjectAuditEvent[]>([])
  const [more,setMore]=useState(false),[historyLoading,setHistoryLoading]=useState(false),[estimating,setEstimating]=useState(false)
  const [summary,setSummary]=useState<{id:string; title:string} | null>(null)
  const [restore,setRestore]=useState<string | null>(null)
  const dirty=useRef(false),epoch=useRef(0),historyEpoch=useRef(0),estimateEpoch=useRef(0)
  const refresh=useCallback(async () => {
    const token=++epoch.current
    try {const [p,m]=await Promise.all([projectApi.detail(projectId),projectApi.memory(projectId,sessionId)]);if(token===epoch.current){setProject(p);setMemory(old=>({...m,capacity:old?.project_prompt===m.project_prompt?old.capacity:undefined}));setError(null)}}
    catch(error){if(token===epoch.current)setError(error instanceof Error ? error.message : '读取项目记忆失败')}
  },[projectId,sessionId])
  useEffect(()=>{
    if(!open)return
    setProject(null);setMemory(null);setError(null);setHistory([]);dirty.current=false
    void refresh()
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh()},5000)
    const counter=epoch,historyCounter=historyEpoch,estimateCounter=estimateEpoch
    return ()=>{counter.current++;historyCounter.current++;estimateCounter.current++;setEstimating(false);clearInterval(timer)}
  },[open,refresh])
  useUnsavedNavigation(()=>dirty.current,open)
  const leave=()=>{if(!dirty.current || window.confirm('项目记忆有未保存的修改，放弃修改并关闭？'))onClose()}
  const changeSection=(next:Section)=>{if(next===section)return;if(dirty.current && !window.confirm('放弃当前未保存的修改并切换分区？'))return;dirty.current=false;setRestore(null);setSection(next)}
  const loadHistory=async (append=false)=>{
    const token=++historyEpoch.current;setHistoryLoading(true)
    try {const rows=await projectApi.memoryHistory(projectId,append ? history.at(-1)?.seq || 0 : 0);if(token===historyEpoch.current){setHistory(old=>append ? [...old,...rows] : rows);setMore(rows.length===20);setError(null)}}
    catch(error){if(token===historyEpoch.current)setError(error instanceof Error ? error.message : '读取修改记录失败')}
    finally{if(token===historyEpoch.current)setHistoryLoading(false)}
  }
  useEffect(()=>{if(open && section==='history')void loadHistory(); /* 分区切换才读取全文审计 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,section,projectId])
  const changed=()=>{void refresh();onChanged?.()}
  return <Sheet open={open} onOpenChange={value=>{if(!value)leave()}}><SheetContent showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[760px]">
    <SheetHeader className="shrink-0 border-b pr-14"><SheetTitle className="flex items-center gap-2"><BookOpen className="size-4"/>项目记忆{project && <span className="truncate text-sm font-normal text-muted-foreground">{project.name}</span>}</SheetTitle><SheetDescription>说明是长期要求，笔记是共同积累，摘要是有限近期背景。保存的修改在下一次新运行生效；等待回复的续接保留原版本。</SheetDescription><Button className="absolute right-3 top-3" variant="ghost" size="icon-sm" aria-label="关闭项目记忆" onClick={leave}><X/></Button></SheetHeader>
    <div role="tablist" aria-label="项目记忆分区" className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2">{sections.map(([id,label])=><Button key={id} role="tab" id={`memory-tab-${id}`} tabIndex={section===id?0:-1} aria-selected={section===id} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const index=sections.findIndex(([key])=>key===section);const next=sections[event.key==='Home'?0:event.key==='End'?sections.length-1:(index+(event.key==='ArrowLeft'?-1:1)+sections.length)%sections.length][0];changeSection(next);document.getElementById(`memory-tab-${next}`)?.focus()}}} variant={section===id?'secondary':'ghost'} size="sm" onClick={()=>changeSection(id)}>{label}</Button>)}</div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {error && <div role="alert" className="mb-4 text-meta text-state-failed">{error}<Button size="sm" variant="ghost" onClick={()=>void refresh()}>重新读取</Button></div>}
      {!project && !error && <p className="text-meta text-faint">正在读取项目记忆</p>}
      {project && (section==='instructions' || section==='notes') && <MemoryEditor key={`${projectId}:${section}`} field={section} project={project} restored={restore} onDirty={value=>{dirty.current=value}} onSaved={changed}/>}
      {section==='summaries' && memory && <div className="space-y-4"><p className="text-meta text-muted-foreground">最多参考近期 10 段对话，注入文本合计不超过 1500 字符。摘要不能替代原始材料；当前对话不纳入自己的背景。</p>{!memory.candidates.length && <p className="py-6 text-meta text-faint">还没有可参考的摘要。项目任务完成后自动生成，也可在对话列表中改写。</p>}{memory.candidates.map(item=>{const included=memory.project.summaries.find(value=>value.session_id===item.session_id);return <article key={item.session_id} className="space-y-2 border-b pb-4"><Link href={`/sessions/${item.session_id}`} className="text-sm text-signal underline">{item.title || '项目对话'}</Link><p className="text-meta text-muted-foreground">{item.source==='manual'?'手动改写':'自动摘要'} · {included ? included.truncated?'部分纳入预览':'纳入预览':'预算已满，未纳入'}{item.stale?' · 有后续对话，摘要可能过时':''}{item.state==='generating'?' · 正在生成，保留旧内容':item.state==='failed'?' · 最近生成失败，保留旧内容':''}</p><p className="whitespace-pre-wrap break-words text-sm">{item.summary}</p>{item.error && <p className="text-meta text-state-failed">{item.error}</p>}<Button size="sm" variant="outline" onClick={()=>setSummary({id:item.session_id,title:item.title})}>查看与改写摘要</Button></article>})}</div>}
      {section==='preview' && memory && <div className="space-y-4"><p className="text-meta text-muted-foreground">这是此刻用于下一次新运行的项目内容；受理时会重新读取。完整请求还包括基础提示、工具和对话，容量结果以受理检查为准。</p><Button variant="outline" size="sm" disabled={estimating} onClick={async()=>{const token=++estimateEpoch.current;setEstimating(true);try{const result=await projectApi.estimateMemory(projectId,sessionId);if(token===estimateEpoch.current){setMemory(result);setError(null)}}catch(error){if(token===estimateEpoch.current)setError(error instanceof Error?error.message:'估算失败')}finally{if(token===estimateEpoch.current)setEstimating(false)}}}>{estimating?'正在读取工具与估算':'估算当前固定输入容量'}</Button>{memory.capacity && <div role="status" className="space-y-2 rounded-md border p-3 text-meta"><p>{memory.capacity.model} · 固定输入约 {memory.capacity.total} / {memory.capacity.limit} tokens</p><p>{memory.capacity.source}</p><p>系统内容 {memory.capacity.system_prompt}，工具 {memory.capacity.tools}（{memory.capacity.tool_count} 个）。实际请求仍需为对话留空间。</p>{memory.capacity.over_limit && <p className="text-state-failed">固定内容已超限，压缩历史不能解决。请精简项目说明/笔记后重新估算，或调整模型窗口。</p>}{Object.entries(memory.capacity.discovery_errors).map(([name,error])=><p className="text-state-waiting" key={name}>{name}：{error}，本次估算未纳入其工具；恢复后需要重新估算。</p>)}</div>}<pre className="whitespace-pre-wrap break-words rounded-md border p-4 text-sm">{memory.project_prompt}</pre>{memory.frozen && <details><summary className="cursor-pointer text-sm">当前活动运行使用的冻结内容</summary><p className="my-2 text-meta text-faint">说明版本 {memory.frozen.settings_version}，笔记版本 {memory.frozen.notes_version}。新保存的内容不会改变这次运行。</p><pre className="whitespace-pre-wrap break-words border p-3 text-sm">{memory.frozen.instructions || '未设置说明'}{'\n\n'}{memory.frozen.notes || '未设置笔记'}</pre></details>}</div>}
      {section==='history' && <div className="space-y-3"><p className="text-meta text-muted-foreground">取回旧笔记会载入编辑草稿，保存时生成新版本；文件恢复不会回滚记忆。</p>{history.map(event=><details key={event.seq} className="border-b pb-3"><summary className="cursor-pointer text-sm">{event.type==='project_notes'?'笔记修改':event.type==='project_settings'?'项目说明与名称':event.type==='conversation_summary'?'摘要更新':'摘要生成记录'} · {new Date(event.created_at).toLocaleString()}</summary><p className="my-2 text-meta text-faint">{event.payload.source==='agent'?'Agent':event.payload.source==='user'||event.payload.source==='manual'?'用户':'自动生成'}{event.payload.notes_version != null && ` · 版本 ${event.payload.notes_version}`}</p>{typeof event.payload.session_id==='string' && <Link className="text-meta text-signal underline" href={`/sessions/${event.payload.session_id}`}>打开来源对话</Link>}{!!event.payload.auxiliary && typeof event.payload.auxiliary==='object' && <p className="text-meta text-faint">摘要辅助请求：{String((event.payload.auxiliary as Record<string,unknown>).model || '模型未记录')}，{String((event.payload.auxiliary as Record<string,unknown>).duration_ms ?? '未知')} ms，用量：{(event.payload.auxiliary as Record<string,unknown>).usage?JSON.stringify((event.payload.auxiliary as Record<string,unknown>).usage):'服务未返回或未完成'}</p>}<pre className="my-3 whitespace-pre-wrap break-words text-sm">{String(event.payload.content ?? event.payload.instructions ?? event.payload.summary ?? event.payload.error ?? event.payload.reason ?? '')}</pre>{event.type==='project_notes' && typeof event.payload.content==='string' && <Button size="sm" variant="outline" onClick={()=>{setRestore(String(event.payload.content));setSection('notes')}}>取回到编辑草稿</Button>}</details>)}{historyLoading && <p role="status" className="text-meta text-faint">正在读取修改记录</p>}{!historyLoading && !history.length && <p className="text-meta text-faint">还没有记忆修改记录</p>}{more && <Button variant="outline" size="sm" onClick={()=>void loadHistory(true)}>加载更早记录</Button>}</div>}
    </div>
    <ProjectSummaryDialog sessionId={summary?.id || null} title={summary?.title || ''} onClose={()=>setSummary(null)} onChanged={changed}/>
  </SheetContent></Sheet>
}

function MemoryEditor({field,project,restored,onDirty,onSaved}: {field:'instructions'|'notes'; project:ProjectDetails; restored:string|null; onDirty:(value:boolean)=>void; onSaved:()=>void}) {
  const current=field==='notes'?project.notes:project.instructions || ''
  const version=field==='notes'?project.notes_version:project.settings_version
  const [draft,setDraft]=useState(restored ?? current),[base,setBase]=useState(version),[original,setOriginal]=useState(current)
  const [editing,setEditing]=useState(restored!==null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false)
  const [conflict,setConflict]=useState<{text:string;version:number}|null>(null)
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
  const dirty=editing && draft!==original
  useEffect(()=>{onDirty(dirty)},[dirty,onDirty])
  const start=()=>{setOriginal(current);setDraft(current);setBase(version);setEditing(true);setSaved(false);setError(null);setConflict(null)}
  const save=async()=>{
    if(busy || !dirty)return
    setBusy(true);setError(null)
    try {
      if(field==='notes')await projectApi.updateNotes(project.id,draft,base)
      else await projectApi.update(project.id,{name:project.name,instructions:draft || null,settings_version:base})
      if(alive.current){setOriginal(draft);setEditing(false);setSaved(true);setConflict(null);onDirty(false);onSaved()}
    }catch(error){if(alive.current){setError(error instanceof Error?error.message:'保存失败，草稿已保留');if(error instanceof ApiError && error.code===409){const latest=await projectApi.detail(project.id).catch(()=>null);if(alive.current && latest)setConflict({text:field==='notes'?latest.notes:latest.instructions || '',version:field==='notes'?latest.notes_version:latest.settings_version})}}}
    finally{if(alive.current)setBusy(false)}
  }
  const title=field==='notes'?'项目笔记':'项目说明'
  return <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-base font-medium">{title}</h2>{!editing && <Button size="sm" variant="outline" onClick={start}>编辑{title}</Button>}</div><p className="text-meta text-muted-foreground">{field==='notes'?'你和 Agent 共同维护的结论、决策、待办与重要文件位置。':'给 Agent 的长期目标、工作要求和交付偏好；例如报告格式、数据口径与引用要求。'}</p><p className="text-meta text-faint">当前版本 {version}{editing && version!==base && ' · 内容已被其他操作更新，保存前需比较'}</p>
    {editing ? <><label className="sr-only" htmlFor={`memory-${field}`}>{title}全文</label><textarea id={`memory-${field}`} disabled={busy} maxLength={8000} className="min-h-[45vh] w-full rounded-md border bg-background p-3 text-sm leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft} onChange={event=>setDraft(event.target.value)}/><p className="text-meta text-faint">{draft.length} / 8000 字符。保存整体替换此分区；留空可以清除。</p>{conflict && <div className="space-y-3 rounded-md border border-state-waiting p-3"><p className="text-meta">最新版本 {conflict.version}，你的草稿已保留。比较后在上方合并内容。</p><details><summary className="cursor-pointer text-meta">编辑前的内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{original}</pre></details><details open><summary className="cursor-pointer text-meta">最新内容</summary><pre className="whitespace-pre-wrap break-words text-sm">{conflict.text || '（空）'}</pre></details><Button size="sm" variant="outline" onClick={()=>{setBase(conflict.version);setOriginal(conflict.text);setConflict(null);setError(null)}}>已比较，以最新版本保存合并稿</Button></div>}<div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3"><Button disabled={busy || !dirty || !!conflict} onClick={()=>void save()}>{busy?'正在保存':'保存'+title}</Button><Button disabled={busy} variant="outline" onClick={()=>{if(!dirty || window.confirm('放弃未保存的修改？')){setEditing(false);onDirty(false);setError(null);setConflict(null)}}}>取消编辑</Button></div></> : <p className="min-h-24 whitespace-pre-wrap break-words text-sm leading-7">{current || (field==='notes'?'还没有笔记。可写下已确认的结论、待办和材料位置，Agent 也会在任务中更新。':'还没有项目说明。写下长期目标和偏好，让新对话沿用同一要求。')}</p>}
    {saved && <p role="status" className="text-meta text-state-success">已保存，下一次新运行生效。</p>}{error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
  </section>
}
