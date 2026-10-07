'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {sessionApi} from '@/lib/api/session'
import {ApiError} from '@/lib/api/fetch'
import type {ConversationSummary} from '@/lib/api/types'

export function ProjectSummaryDialog({sessionId,title,onClose,onChanged}: {sessionId:string|null;title:string;onClose:()=>void;onChanged:()=>void}) {
  const [summary,setSummary]=useState<ConversationSummary|null>(null),[draft,setDraft]=useState(''),[original,setOriginal]=useState('')
  const [base,setBase]=useState(0),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[generating,setGenerating]=useState(false),[reloading,setReloading]=useState(false)
  const [conflict,setConflict]=useState<ConversationSummary|null>(null)
  const dirty=useRef(false),epoch=useRef(0),request=useRef(0),initialized=useRef(false),mutating=useRef(false)
  useUnsavedNavigation(()=>dirty.current,!!sessionId)
  const accept=useCallback((value:ConversationSummary,replace:boolean)=>{
    setSummary(value)
    if(replace){setDraft(value.summary || '');setOriginal(value.summary || '');setBase(value.summary_generation);dirty.current=false;initialized.current=true;setConflict(null)}
  },[])
  const refresh=useCallback(async()=>{
    if(!sessionId)return
    const token=++request.current,scope=epoch.current
    setLoading(true)
    try {const value=await sessionApi.summary(sessionId);if(token===request.current && scope===epoch.current){accept(value,(!initialized.current || !dirty.current) && !mutating.current);setError(null)}}
    catch(error){if(token===request.current && scope===epoch.current)setError(error instanceof Error?error.message:'读取摘要失败')}
    finally{if(token===request.current && scope===epoch.current)setLoading(false)}
  },[sessionId,accept])
  useEffect(()=>{
    epoch.current++;initialized.current=false;dirty.current=false;mutating.current=false;setSummary(null);setError(null);setLoading(false);setSaving(false);setGenerating(false);setReloading(false);setConflict(null)
    if(!sessionId)return
    void refresh()
    const visible=()=>{if(document.visibilityState!=='hidden' && !mutating.current)void refresh()}
    let debounce: number | undefined
    const unsubscribe=subscribeCatalog((hint)=>{
      if(!sessionId || hint.kind!=='session' || hint.id!==sessionId)return
      window.clearTimeout(debounce)
      debounce=window.setTimeout(visible,300)
    })
    window.addEventListener('focus', visible)
    const counter=epoch
    return ()=>{counter.current++;window.clearTimeout(debounce);unsubscribe();window.removeEventListener('focus', visible)}
  },[sessionId,refresh])
  useEffect(()=>{
    if(summary?.summary_state!=='generating')return
    const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden' && !mutating.current)void refresh()},3000)
    return ()=>window.clearInterval(timer)
  },[summary?.summary_state,refresh])
  const reload=async()=>{
    if(!sessionId || mutating.current || (dirty.current && !window.confirm('重新加载会放弃未保存的摘要修改，是否继续？')))return
    const scope=epoch.current;mutating.current=true;setReloading(true);setError(null)
    try {const value=await sessionApi.summary(sessionId);if(scope===epoch.current){accept(value,true);setError(null)}}catch(error){if(scope===epoch.current)setError(error instanceof Error?error.message:'刷新失败')}
    finally{if(scope===epoch.current){setReloading(false);mutating.current=false}}
  }
  const action=async(kind:'save'|'generate')=>{
    if(!sessionId || mutating.current)return
    if(kind==='generate' && (dirty.current || summary?.summary_state==='generating') && !window.confirm('重新生成会使此前生成失效，并放弃未保存的改写。是否继续？'))return
    const scope=epoch.current;mutating.current=true;if(kind==='save'){setSaving(true)}else{setGenerating(true)};setError(null)
    try {const value=kind==='save'?await sessionApi.editSummary(sessionId,draft,base):await sessionApi.regenerateSummary(sessionId);if(scope===epoch.current){accept(value,true);onChanged()}}
    catch(error){if(scope===epoch.current){setError(error instanceof Error?error.message:(kind==='save'?'保存失败':'生成失败')+'，结果尚未确认，草稿保留，请读取最新状态');if(error instanceof ApiError && error.code===409){const latest=await sessionApi.summary(sessionId).catch(()=>null);if(latest && scope===epoch.current)setConflict(latest)}}}
    finally{if(scope===epoch.current){setSaving(false);setGenerating(false);mutating.current=false}}
  }
  return <Dialog open={!!sessionId} onOpenChange={value=>{if(!value && !saving && !generating && !reloading && (!dirty.current || window.confirm('放弃未保存的摘要修改？')))onClose()}}><DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[680px]">
    <DialogHeader><DialogTitle>对话摘要</DialogTitle><DialogDescription>{title}。摘要供后续对话参考，不能替代完整历史。手动改写不会被自动更新覆盖；重新生成成功后才改为自动来源。</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-3 overflow-y-auto">
    {loading && !summary && <p className="text-meta text-faint">正在加载摘要</p>}
    {summary ? <><p className="text-meta text-muted-foreground">{summary.summary_source==='manual'?'手动改写':summary.summary_source==='auto'?'自动摘要':'尚无摘要'}{summary.summary_state==='generating'?' · 正在生成，已有摘要保留':summary.summary_state==='failed'?' · 最近生成失败，已有摘要保留':''}</p><textarea aria-label="对话摘要全文" className="min-h-48 w-full rounded-md border bg-background p-3 text-sm leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={1500} value={draft} disabled={saving || generating || reloading} onChange={event=>{dirty.current=event.target.value!==original;setDraft(event.target.value)}}/><p className="text-meta text-faint">{draft.length} / 1500 字符。生成依据目标、近期用户修订、完成结果及运行状态；计划和失败不算完成。</p>{summary.summary_error && <p role="alert" className="text-meta text-state-failed">{summary.summary_error}</p>}<details className="text-meta text-faint"><summary>摘要来源范围</summary><p>生成代次 {summary.summary_generation}，材料截止消息序号 {summary.summary_source_seq}。旧代次结果不会覆盖当前内容。</p></details></> : !error && !loading && <p className="text-meta text-faint">摘要未加载</p>}
    {conflict && <div className="space-y-2 rounded-md border p-3"><p className="text-meta">最新摘要如下，你的草稿保留在上方。比较并合并后再保存。</p><pre className="whitespace-pre-wrap break-words text-sm">{conflict.summary || '（空）'}</pre><Button size="sm" variant="outline" onClick={()=>{setBase(conflict.summary_generation);setOriginal(conflict.summary || '');dirty.current=draft!==(conflict.summary || '');setConflict(null);setError(null)}}>已比较，使用最新版本保存</Button></div>}
    {error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p>{!summary && <Button size="sm" variant="outline" onClick={()=>void refresh()}>重试</Button>}</div>}
    </div><div className="flex shrink-0 flex-wrap gap-2 border-t pt-3">{summary && <><Button disabled={saving || generating || reloading || !!conflict || !dirty.current} onClick={()=>void action('save')}>{saving?'正在保存':'保存改写'}</Button><Button variant="outline" disabled={saving || generating || reloading} onClick={()=>void action('generate')}>{generating?'正在受理生成':'重新生成'}</Button></>}<Button variant="ghost" disabled={saving || generating || reloading} onClick={()=>void reload()}>{reloading?'正在刷新':'重新加载'}</Button></div>
  </DialogContent></Dialog>
}
