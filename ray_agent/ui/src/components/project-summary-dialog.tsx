'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {sessionApi} from '@/lib/api/session'
import type {ConversationSummary} from '@/lib/api/types'

export function ProjectSummaryDialog({sessionId,title,onClose,onChanged}: {sessionId:string | null;title:string;onClose:()=>void;onChanged:()=>void}) {
  const [summary,setSummary]=useState<ConversationSummary | null>(null),[draft,setDraft]=useState('')
  const [base,setBase]=useState(0),[error,setError]=useState<string | null>(null),[busy,setBusy]=useState(false)
  const dirty=useRef(false),request=useRef(0),initialized=useRef(false)
  useEffect(() => {
    initialized.current=false;dirty.current=false
    if(!sessionId)return
    let live=true
    const requestCounter=request
    async function refresh() {
      const token=++request.current
      try {const value=await sessionApi.summary(sessionId!);if(live && token===request.current){setSummary(value);if(!initialized.current || !dirty.current){setDraft(value.summary || '');setBase(value.summary_generation);initialized.current=true}}}
      catch(error){if(live && token===request.current)setError(error instanceof Error ? error.message : '读取摘要失败')}
    }
    setSummary(null);setError(null);void refresh()
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh()},3000)
    return ()=>{live=false;requestCounter.current++;clearInterval(timer)}
  },[sessionId])
  const reload=async () => {
    if(!sessionId || (dirty.current && !window.confirm('重新加载会放弃未保存的摘要修改，是否继续？')))return
    try {const value=await sessionApi.summary(sessionId);setSummary(value);setDraft(value.summary || '');setBase(value.summary_generation);dirty.current=false;setError(null)}catch(error){setError(error instanceof Error ? error.message : '读取失败')}
  }
  const save=async () => {
    if(!sessionId)return
    setBusy(true);setError(null)
    try {const value=await sessionApi.editSummary(sessionId,draft,base);setSummary(value);setBase(value.summary_generation);dirty.current=false;onChanged()}
    catch(error){setError(error instanceof Error ? error.message : '保存摘要失败')}
    finally{setBusy(false)}
  }
  const regenerate=async () => {
    if(!sessionId)return
    if((dirty.current || summary?.summary_state==='generating') && !window.confirm('重新生成会使此前生成结果失效，并放弃未保存的改写。是否继续？'))return
    setBusy(true);setError(null)
    try {const value=await sessionApi.regenerateSummary(sessionId);setSummary(value);setDraft(value.summary || '');setBase(value.summary_generation);dirty.current=false;onChanged()}
    catch(error){setError(error instanceof Error ? error.message : '摘要生成未受理，请重新读取状态')}
    finally{setBusy(false)}
  }
  return <Dialog open={!!sessionId} onOpenChange={open=>{if(!open && (!dirty.current || window.confirm('放弃未保存的摘要修改？')))onClose()}}><DialogContent className="sm:max-w-[540px]">
    <DialogHeader><DialogTitle>对话摘要</DialogTitle><DialogDescription>{title}。摘要供后续对话参考，不能替代完整历史。手动改写后，自动更新不会覆盖；重新生成会恢复自动来源。</DialogDescription></DialogHeader>
    {summary ? <div className="space-y-3"><p className="text-meta text-faint">{summary.summary_source==='manual' ? '手动改写' : summary.summary_source==='auto' ? '自动摘要' : '尚无摘要'}{summary.summary_state==='generating' && '，正在生成'}{summary.summary_state==='failed' && '，最近一次生成失败'}</p>
      <textarea aria-label="对话摘要全文" className="min-h-32 w-full rounded-md border bg-background p-3 text-sm" maxLength={1500} value={draft} disabled={busy} onChange={event=>{dirty.current=true;setDraft(event.target.value)}}/>
      <p className="text-meta text-faint">{draft.length} / 1500 字符。生成只读取最初目标与已完成运行的最终答复。</p>
      {summary.summary_error && <p role="alert" className="text-meta text-state-failed">{summary.summary_error}；已有摘要保留。</p>}
      <details className="text-meta text-faint"><summary>摘要来源</summary><p>生成代次 {summary.summary_generation}，材料截止消息序号 {summary.summary_source_seq}。较早代次的结果会被丢弃，不能覆盖当前摘要。</p></details>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void save()}>保存改写</Button><Button variant="outline" disabled={busy} onClick={()=>void regenerate()}>重新生成</Button><Button variant="ghost" disabled={busy} onClick={()=>void reload()}>重新加载</Button></div>
    </div> : <p className="text-meta text-faint">正在读取摘要</p>}
    {error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
  </DialogContent></Dialog>
}
