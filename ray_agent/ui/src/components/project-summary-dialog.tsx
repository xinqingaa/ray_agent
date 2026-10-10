'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {Loader2, Sparkles} from 'lucide-react'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {sessionApi} from '@/lib/api/session'
import {ApiError} from '@/lib/api/fetch'
import type {ConversationSummary} from '@/lib/api/types'

export function ProjectSummaryDialog({sessionId,title,onClose,onChanged,embedded=false,onDirty,onBusy}: {sessionId:string|null;title:string;onClose:()=>void;onChanged:()=>void;embedded?:boolean;onDirty?:(value:boolean)=>void;onBusy?:(value:boolean)=>void}) {
  const [summary,setSummary]=useState<ConversationSummary|null>(null),[draft,setDraft]=useState(''),[original,setOriginal]=useState('')
  const [base,setBase]=useState(0),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[generating,setGenerating]=useState(false)
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
    epoch.current++;initialized.current=false;dirty.current=false;mutating.current=false;setSummary(null);setError(null);setLoading(false);setSaving(false);setGenerating(false);setConflict(null)
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
  useEffect(()=>{onDirty?.(!!sessionId && draft!==original)},[sessionId,draft,original,onDirty])
  useEffect(()=>{onBusy?.(saving || generating);return ()=>onBusy?.(false)},[saving,generating,onBusy])
  const action=async(kind:'save'|'generate')=>{
    if(!sessionId || mutating.current)return
    if(kind==='generate' && (dirty.current || summary?.summary_state==='generating') && !window.confirm('重新生成会使此前生成失效，并放弃未保存的改写。是否继续？'))return
    const scope=epoch.current;mutating.current=true;if(kind==='save'){setSaving(true)}else{setGenerating(true)};setError(null)
    try {const value=kind==='save'?await sessionApi.editSummary(sessionId,draft,base):await sessionApi.regenerateSummary(sessionId);if(scope===epoch.current){accept(value,true);onChanged()}}
    catch(error){if(scope===epoch.current){setError(error instanceof Error?error.message:(kind==='save'?'保存失败':'生成失败')+'，结果尚未确认，草稿保留，请读取最新状态');if(error instanceof ApiError && error.code===409){const latest=await sessionApi.summary(sessionId).catch(()=>null);if(latest && scope===epoch.current)setConflict(latest)}}}
    finally{if(scope===epoch.current){setSaving(false);setGenerating(false);mutating.current=false}}
  }
  const content = <>
    {embedded && <DialogHeader><p className="truncate text-xs text-muted-foreground">{title}</p></DialogHeader>}
        <div className="min-h-0 space-y-3 overflow-y-auto">
    {loading && !summary && <p className="text-meta text-faint">正在加载摘要</p>}
    {summary ? <>{summary.summary_state==='generating' && <p role="status" className="text-meta text-muted-foreground">正在生成</p>}<textarea aria-label="对话摘要全文" className="min-h-48 w-full rounded-md border bg-background p-3 text-sm leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={1500} value={draft} disabled={saving || generating} onChange={event=>{dirty.current=event.target.value!==original;setDraft(event.target.value)}}/><p className="text-meta tabular-nums text-faint">{draft.length} / 1500</p>{summary.summary_error && <p role="alert" className="text-meta text-state-failed">{summary.summary_error}</p>}</> : !error && !loading && <p className="text-meta text-faint">摘要未加载</p>}
    {conflict && <div className="space-y-2 rounded-md border p-3"><p className="text-meta">最新摘要如下，你的草稿保留在上方。比较并合并后再保存。</p><pre className="whitespace-pre-wrap break-words text-sm">{conflict.summary || '（空）'}</pre><Button size="sm" variant="outline" onClick={()=>{setBase(conflict.summary_generation);setOriginal(conflict.summary || '');dirty.current=draft!==(conflict.summary || '');setConflict(null);setError(null)}}>已比较，使用最新版本保存</Button></div>}
    {error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p>{!summary && <Button size="sm" variant="outline" onClick={()=>void refresh()}>重试</Button>}</div>}
    </div><div className="flex shrink-0 items-center gap-2 border-t pt-3">{summary && <><IconAction label="重新生成摘要" className="text-signal" disabled={saving || generating || summary.summary_state==='generating'} onClick={()=>void action('generate')}>{generating ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}</IconAction><Button className="ml-auto" disabled={saving || generating || !!conflict || !dirty.current} onClick={()=>void action('save')}>{saving?'正在保存':'保存'}</Button></>}</div>

  </>
  if(embedded)return <section className="flex min-h-0 flex-col gap-4">{content}</section>
  return <Dialog open={!!sessionId} onOpenChange={value=>{if(!value && !saving && !generating && (!dirty.current || window.confirm('放弃未保存的摘要修改？')))onClose()}}><DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[680px]">
    <DialogHeader><DialogTitle>编辑摘要</DialogTitle><DialogDescription className="truncate">{title}</DialogDescription></DialogHeader>
    {content}
  </DialogContent></Dialog>
}
