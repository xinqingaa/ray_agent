'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {ProjectPane} from './project-pane'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'
import {ProjectStateNotice,projectWriteReason} from '@/components/project-state-notice'
import {projectApi} from '@/lib/api/project'
import type {ProjectAuditEvent,ProjectDetails,ProjectSnapshot} from '@/lib/api/types'
import {formatBytes} from '@/components/run/format'

const sources={run:'运行前',upload:'上传前',restore:'恢复前'}
const eventNames: Record<string,string>={project_notes:'项目笔记',project_settings:'项目设置',conversation_summary:'对话摘要',conversation_summary_discarded:'旧摘要结果已丢弃',file_operation:'文件操作',snapshot:'快照',attachment:'附件副本',delivery:'交付副本'}

export function ManagedProjectPane({projectId,refreshSignal}: {projectId:string;refreshSignal?:number}) {
  const [project,setProject]=useState<ProjectDetails | null>(null),[snapshots,setSnapshots]=useState<ProjectSnapshot[]>([])
  const [tab,setTab]=useState<'files' | 'snapshots'>('files'),[upload,setUpload]=useState(false)
  const [error,setError]=useState<string | null>(null),[busy,setBusy]=useState<string | null>(null),[revision,setRevision]=useState(0)
  const [events,setEvents]=useState<ProjectAuditEvent[]>([]),[auditOpen,setAuditOpen]=useState(false),[moreEvents,setMoreEvents]=useState(true),[auditError,setAuditError]=useState<string | null>(null)
  const [confirmation,setConfirmation]=useState<{name:string;text:string;run:()=>Promise<unknown>} | null>(null)
  const confirm=(name:string,text:string,run:()=>Promise<unknown>)=>setConfirmation({name,text,run})
  const request=useRef(0),auditRequest=useRef(0)
  const refresh=useCallback(async () => {
    const token=++request.current
    try {const [detail,list]=await Promise.all([projectApi.detail(projectId),projectApi.snapshots(projectId)]);if(token===request.current){setProject(detail);setSnapshots(list);setError(null)}}
    catch(error){if(token===request.current)setError(error instanceof Error ? error.message : '读取项目状态失败')}
  },[projectId])
  useEffect(() => {
    void refresh()
    const requests=request,audits=auditRequest
    const timer=setInterval(() => {if(document.visibilityState!=='hidden')void refresh()},5000)
    return () => {requests.current++;audits.current++;clearInterval(timer)}
  },[refresh,refreshSignal])
  const changed=() => {setRevision(value=>value+1);void refresh()}
  const action=async (name:string,run:()=>Promise<unknown>) => {
    setBusy(name);setError(null)
    try {await run();changed()}
    catch(error){setError(error instanceof Error ? error.message : '操作失败，请核对状态后重试')}
    finally {setBusy(null);void refresh()}
  }
  const audit=async (append=false) => {
    const token=++auditRequest.current;setAuditError(null)
    try {const page=await projectApi.events(projectId,append ? events.at(-1)?.seq || 0 : 0);if(token===auditRequest.current){setEvents(previous=>append ? [...previous,...page] : page);setMoreEvents(page.length===50)}}
    catch(error){if(token===auditRequest.current)setAuditError(error instanceof Error ? error.message : '读取记录失败')}
  }
  const download=async () => {
    try {const value=await projectApi.download(projectId);if(value.warning)toast.warning(value.warning);const a=document.createElement('a');a.href=value.url;a.download=value.filename;document.body.appendChild(a);a.click();a.remove()}
    catch(error){toast.error(error instanceof Error ? error.message : '下载失败')}
  }
  const reason=projectWriteReason(project),op=project?.file_operation
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2"><Button variant={tab==='files'?'secondary':'ghost'} size="sm" onClick={()=>setTab('files')}>文件</Button><Button variant={tab==='snapshots'?'secondary':'ghost'} size="sm" onClick={()=>setTab('snapshots')}>快照</Button><Button variant="ghost" size="sm" className="ml-auto" onClick={()=>void refresh()}>刷新</Button></div>
    {project && <div className="border-b px-3 py-2"><ProjectStateNotice project={project} onChanged={changed}/></div>}
    {error && <p role="alert" className="px-3 py-2 text-meta text-state-failed">{error}<Button variant="ghost" size="sm" onClick={()=>void refresh()}>重新读取状态</Button></p>}
    {!project && !error && <p className="px-3 py-4 text-meta text-faint">正在读取项目状态</p>}
    {tab==='files' && <><div className="flex flex-wrap gap-2 px-3 py-2"><Button variant="outline" size="sm" disabled={!!reason || !!busy} title={reason || undefined} onClick={()=>setUpload(true)}>上传</Button><Button variant="outline" size="sm" disabled={!project?.available} onClick={()=>void download()}>下载整个项目</Button>{reason && <p className="w-full text-meta text-faint">{reason}</p>}</div><ProjectPane sessionId={projectId} projectLevel downloadProjectId={projectId} refreshSignal={(refreshSignal||0)+revision}/></>}
    {tab==='snapshots' && <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-meta">
      <p className="text-faint">快照保存最近几次操作前的项目文件，不能替代完整历史。恢复会原地替换文件，并先保存当前版本。</p>
      {op?.kind==='restore' && op.state==='failed' && op.before_snapshot_id && <div className="space-y-2 border-l-2 border-state-failed pl-3"><p>本次恢复尚未完成。修复之前不能进行其他写入操作。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>confirm('repair','重试本次恢复，将继续应用已固定的目标快照。',()=>projectApi.repairRestore(projectId,op.operation_id,false))}>重试本次恢复</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>confirm('return','回到本次恢复前的固定快照，撤销已发生的文件替换。',()=>projectApi.repairRestore(projectId,op.operation_id,true))}>回到恢复前</Button></div></div>}
      {snapshots.length===0 && <p className="py-3 text-faint">还没有有效快照。项目运行前会保存一份；超限跳过或准备失败不会生成有效快照。</p>}
      <ul className="divide-y">{snapshots.map(snapshot=><li key={snapshot.id} className="space-y-1 py-3"><div className="flex items-center gap-2"><span className="flex-1">{sources[snapshot.source]} · {new Date(snapshot.created_at).toLocaleString()}</span><span className="tabular-nums">{formatBytes(snapshot.total_bytes)}</span></div><div className="flex flex-wrap items-center gap-2">{snapshot.session_id && <Link className="text-signal underline" href={`/sessions/${snapshot.session_id}`}>关联对话</Link>}{op?.target_snapshot_id===snapshot.id && <span className="text-state-waiting">本次恢复目标</span>}{op?.before_snapshot_id===snapshot.id && <span className="text-state-waiting">本次恢复前保护</span>}<Button size="sm" variant="outline" disabled={!!reason || !!busy} title={reason||undefined} onClick={()=>confirm('restore',`恢复到${sources[snapshot.source]}的项目文件？当前文件会先保存保护快照；之后新增的文件将移除。`,()=>projectApi.restore(projectId,snapshot.id))}>恢复</Button></div></li>)}</ul>
      {reason && <p className="text-faint">{reason}</p>}
      {project?.archived && <div className="border-t pt-3"><Button variant="outline" size="sm" disabled={!!busy || !!op || !!project.occupying_session_id || !snapshots.length} onClick={()=>confirm('cleanup','清理此已归档项目的全部快照？项目文件与对话历史会保留，快照无法再恢复。',()=>projectApi.cleanupSnapshots(projectId))}>清理全部快照</Button></div>}
      {project?.snapshots_cleaned_at && <p className="text-faint">最近清理 {new Date(project.snapshots_cleaned_at).toLocaleString()}，释放 {formatBytes(project.snapshots_released_bytes)}。</p>}
      {busy && <p role="status" className="text-state-running">{busy==='cleanup'?'正在清理快照':busy==='restore'?'正在恢复项目文件':'正在修复恢复'}，请稍候。断线后请重新读取状态。</p>}
      <details open={auditOpen} onToggle={event=>{const open=event.currentTarget.open;setAuditOpen(open);if(open && !events.length)void audit()}} className="border-t pt-3"><summary className="cursor-pointer">项目操作记录</summary><p className="my-2 text-faint">记录供追溯，可从笔记原文取回误改内容；不会自动回放。</p>{events.map(event=><details key={event.seq} className="border-b py-2"><summary className="cursor-pointer">#{event.seq} {eventNames[event.type]||event.type} · {new Date(event.created_at).toLocaleString()}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{JSON.stringify(event.payload,null,2)}</pre></details>)}{auditError && <p role="alert" className="text-state-failed">{auditError}</p>}<Button variant="ghost" size="sm" onClick={()=>void audit()}>刷新记录</Button>{moreEvents && !!events.length && <Button variant="ghost" size="sm" onClick={()=>void audit(true)}>加载更多记录</Button>}</details>
    </div>}
    <Dialog open={!!confirmation} onOpenChange={open=>{if(!open)setConfirmation(null)}}><DialogContent>
      <DialogHeader><DialogTitle>确认项目文件操作</DialogTitle><DialogDescription>{confirmation?.text}</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirmation(null)}>取消</Button><Button disabled={!!busy} onClick={()=>{const pending=confirmation;if(!pending)return;setConfirmation(null);void action(pending.name,pending.run)}}>确认{confirmation?.name==='cleanup' ? '清理快照' : confirmation?.name==='restore' ? '恢复' : '修复'}</Button></div>
    </DialogContent></Dialog>
    <ProjectUploadDialog open={upload} projectId={projectId} disabledReason={reason} onClose={()=>setUpload(false)} onUploaded={changed}/>
  </div>
}
