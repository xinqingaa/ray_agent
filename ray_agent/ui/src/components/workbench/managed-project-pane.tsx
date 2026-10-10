'use client'
import {RefreshCw} from 'lucide-react'
import {IconAction} from '@/components/ui/icon-action'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {toast} from 'sonner'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Button} from '@/components/ui/button'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {ProjectPane} from './project-pane'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'
import {ProjectStateNotice,projectWriteReason} from '@/components/project-state-notice'
import {subscribeCatalog} from '@/lib/catalog-bus'
import {projectApi} from '@/lib/api/project'
import type {ProjectAuditEvent,ProjectDetails,ProjectSnapshot} from '@/lib/api/types'
import {formatBytes} from '@/components/run/format'

const sources={run:'开始任务前',upload:'添加材料前',restore:'恢复文件前'}
const eventNames: Record<string,string>={project_notes:'项目笔记',project_settings:'项目设置',conversation_summary:'对话摘要',conversation_summary_discarded:'旧摘要结果已丢弃',file_operation:'文件操作',snapshot:'快照',attachment:'附件副本',delivery:'交付副本'}

export function ManagedProjectPane({projectId,refreshSignal,section = 'files',conversationTitles = {}}: {projectId:string;refreshSignal?:number;section?:'files'|'snapshots'|'audit';conversationTitles?:Record<string,string>}) {
  const [project,setProject]=useState<ProjectDetails | null>(null),[snapshots,setSnapshots]=useState<ProjectSnapshot[]>([])
  const {visibility} = useDeveloperMode()
  const tab = section
  const [upload,setUpload]=useState(false)
  const [error,setError]=useState<string | null>(null),[busy,setBusy]=useState<string | null>(null),[revision,setRevision]=useState(0)
  const [events,setEvents]=useState<ProjectAuditEvent[]>([]),[moreEvents,setMoreEvents]=useState(true),[auditError,setAuditError]=useState<string | null>(null)
  const [confirmation,setConfirmation]=useState<{name:string;text:string;run:()=>Promise<unknown>} | null>(null)
  const confirm=(name:string,text:string,run:()=>Promise<unknown>)=>setConfirmation({name,text,run})
  const request=useRef(0),auditRequest=useRef(0)
  const latestEvents=useRef(events); latestEvents.current=events
  const [auditLoading,setAuditLoading]=useState(section==='audit')
  const refresh=useCallback(async () => {
    const token=++request.current
    try {const [detail,list]=await Promise.all([projectApi.detail(projectId),projectApi.snapshots(projectId)]);if(token===request.current){setProject(detail);setSnapshots(list);setError(null)}}
    catch(error){if(token===request.current)setError(error instanceof Error ? error.message : '读取项目状态失败')}
  },[projectId])
  useEffect(() => {
    void refresh()
    const requests=request,audits=auditRequest
    const visible=() => {if(document.visibilityState!=='hidden')void refresh()}
    let debounce: number | undefined
    const unsubscribe=subscribeCatalog((hint) => {
      if(hint.kind!=='project' || hint.id!==projectId)return
      window.clearTimeout(debounce)
      debounce=window.setTimeout(visible,300)
    })
    const timer=project?.file_operation?.state==='running'
      ? window.setInterval(() => {if(document.visibilityState!=='hidden')void refresh()},5000)
      : undefined
    window.addEventListener('focus', visible)
    return () => {requests.current++;audits.current++;window.clearTimeout(debounce);if(timer!==undefined)window.clearInterval(timer);unsubscribe();window.removeEventListener('focus', visible)}
  },[refresh,refreshSignal,projectId,project?.file_operation?.state,project?.file_operation?.operation_id])
  const changed=() => {setRevision(value=>value+1);void refresh()}
  const action=async (name:string,run:()=>Promise<unknown>) => {
    setBusy(name);setError(null)
    try {await run();changed()}
    catch(error){setError(error instanceof Error ? error.message : '操作失败，请核对状态后重试')}
    finally {setBusy(null);void refresh()}
  }
  const audit=useCallback(async (append=false) => {
    const token=++auditRequest.current;setAuditError(null);setAuditLoading(true)
    try {const page=await projectApi.events(projectId,append ? latestEvents.current.at(-1)?.seq || 0 : 0);if(token===auditRequest.current){setEvents(previous=>append ? [...previous,...page] : page);setMoreEvents(page.length===50)}}
    catch(error){if(token===auditRequest.current)setAuditError(error instanceof Error ? error.message : '读取记录失败')}
    finally {if(token===auditRequest.current)setAuditLoading(false)}
  },[projectId])
  useEffect(() => {if(section !== 'audit')return; const frame=requestAnimationFrame(() => {void audit()}); return () => cancelAnimationFrame(frame)},[section,audit])
  const download=async () => {
    try {const value=await projectApi.download(projectId);if(value.warning)toast.warning(value.warning);const a=document.createElement('a');a.href=value.url;a.download=value.filename;document.body.appendChild(a);a.click();a.remove()}
    catch(error){toast.error(error instanceof Error ? error.message : '下载失败')}
  }
  const reason=projectWriteReason(project),op=project?.file_operation
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center border-b pl-5 pr-12 py-3"><h2 className="mr-auto text-sm font-medium">{section==='files' ? '管理项目文件' : section==='snapshots' ? '恢复项目文件' : '项目操作记录'}</h2><IconAction label={section==='audit' ? '刷新操作记录' : '刷新项目状态'} onClick={()=>{if(section==='audit')void audit();else void refresh()}}><RefreshCw/></IconAction></div>
    {project && section !== 'audit' && <div className="border-b px-3 py-2"><ProjectStateNotice project={project} onChanged={changed}/></div>}
    {error && <p role="alert" className="px-3 py-2 text-meta text-state-failed">{error}<Button variant="ghost" size="sm" onClick={()=>void refresh()}>重新读取状态</Button></p>}
    {!project && !error && <p className="px-3 py-4 text-meta text-faint">正在读取项目状态</p>}
    {tab==='files' && <><p className="px-3 pt-3 text-xs text-muted-foreground">添加的材料供后续任务使用，不会自动发送消息或开始任务。导出包含当前全部文件，不包含对话历史。</p><div className="flex flex-wrap gap-2 px-3 py-2"><Button variant="outline" size="sm" disabled={!!reason || !!busy} title={reason || undefined} onClick={()=>setUpload(true)}>添加材料</Button><Button variant="outline" size="sm" disabled={!project?.available} onClick={()=>void download()}>导出全部项目文件</Button>{reason && <p className="w-full text-meta text-faint">{reason}</p>}</div><ProjectPane sessionId={projectId} projectLevel downloadProjectId={projectId} refreshSignal={(refreshSignal||0)+revision}/></>}
    {tab==='snapshots' && <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-meta">
      <p className="text-faint">系统在部分操作前保存项目文件副本，只保留有限的保存点。恢复会替换当前文件，并先保存保护副本；不会恢复对话、项目说明和笔记。</p>
      {op?.kind==='restore' && op.state==='failed' && op.before_snapshot_id && <div className="space-y-2 border-l-2 border-state-failed pl-3"><p>本次恢复尚未完成。修复之前不能进行其他写入操作。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>confirm('repair','重试本次恢复，将继续应用已固定的目标快照。',()=>projectApi.repairRestore(projectId,op.operation_id,false))}>重试本次恢复</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>confirm('return','回到本次恢复前的固定快照，撤销已发生的文件替换。',()=>projectApi.repairRestore(projectId,op.operation_id,true))}>回到恢复前</Button></div></div>}
      {snapshots.length===0 && <p className="py-3 text-faint">{project?.snapshot_gc_pending ? '快照列表已清空，残留对象尚未清理完成。' : project?.snapshots_cleaned_at ? '快照已清理。项目文件与对话历史保留。' : '还没有有效快照。项目运行前会保存一份；超限跳过或准备失败不会生成有效快照。'}</p>}
      <ul className="divide-y">{snapshots.map(snapshot=><li key={snapshot.id} className="space-y-1 py-3"><div className="flex items-center gap-2"><span className="flex-1">{snapshot.source==='run' && snapshot.session_id && conversationTitles[snapshot.session_id] ? `开始“${conversationTitles[snapshot.session_id]}”前` : sources[snapshot.source]} · {new Date(snapshot.created_at).toLocaleString()}</span><span className="tabular-nums">{formatBytes(snapshot.total_bytes)}</span></div><div className="flex flex-wrap items-center gap-2">{snapshot.session_id && <Link className="text-signal underline" href={`/sessions/${snapshot.session_id}`}>关联对话</Link>}{op?.target_snapshot_id===snapshot.id && <span className="text-state-waiting">本次恢复目标</span>}{op?.before_snapshot_id===snapshot.id && <span className="text-state-waiting">本次恢复前保护</span>}<Button size="sm" variant="outline" disabled={!!reason || !!busy} title={reason||undefined} onClick={()=>confirm('restore',`恢复到${sources[snapshot.source]}的项目文件？当前文件会先保存保护快照；之后新增的文件将移除。`,()=>projectApi.restore(projectId,snapshot.id))}>恢复到此时的文件</Button></div></li>)}</ul>
      {reason && <p className="text-faint">{reason}</p>}
      {project?.archived && <div className="border-t pt-3"><Button variant="outline" size="sm" disabled={!!busy || !!op || !!project.occupying_session_id || (!snapshots.length && !project.snapshot_gc_pending)} onClick={()=>confirm('cleanup',project.snapshot_gc_pending && !snapshots.length ? '继续清理残留快照对象？项目文件与对话历史会保留。' : '清理此已归档项目的全部快照？项目文件与对话历史会保留，快照无法再恢复。',()=>projectApi.cleanupSnapshots(projectId))}>{project.snapshot_gc_pending ? '重试清理快照' : '清理全部快照'}</Button></div>}
      {project?.snapshots_cleaned_at && <p className="text-faint">最近清理 {new Date(project.snapshots_cleaned_at).toLocaleString()}，释放 {formatBytes(project.snapshots_released_bytes)}。</p>}
      {busy && <p role="status" className="text-state-running">{busy==='cleanup'?'正在清理快照':busy==='restore'?'正在恢复项目文件':'正在修复恢复'}，请稍候。断线后请重新读取状态。</p>}

    </div>}
    {section==='audit' && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{auditLoading && <p role="status" className="py-3 text-sm text-muted-foreground">正在读取操作记录……</p>}{events.map(event=>visibility.rawResults ? <details key={event.seq} className="border-b py-3 text-sm"><summary className="cursor-pointer">{eventNames[event.type]||'项目更新'} · {new Date(event.created_at).toLocaleString()}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{JSON.stringify(event.payload,null,2)}</pre></details> : <p key={event.seq} className="border-b py-3 text-sm">{eventNames[event.type] || '项目更新'} · {new Date(event.created_at).toLocaleString()}</p>)}{!auditLoading && !auditError && !events.length && <p className="py-5 text-sm text-muted-foreground">尚无操作记录。</p>}{auditError && <p role="alert" className="py-3 text-sm text-state-failed">{auditError}</p>}{moreEvents && !!events.length && <Button variant="ghost" size="sm" disabled={auditLoading} onClick={()=>void audit(true)}>加载更多</Button>}</div>}

    <Dialog open={!!confirmation} onOpenChange={open=>{if(!open)setConfirmation(null)}}><DialogContent>
      <DialogHeader><DialogTitle>确认项目文件操作</DialogTitle><DialogDescription>{confirmation?.text}</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setConfirmation(null)}>取消</Button><Button disabled={!!busy} onClick={()=>{const pending=confirmation;if(!pending)return;setConfirmation(null);void action(pending.name,pending.run)}}>确认{confirmation?.name==='cleanup' ? '清理快照' : confirmation?.name==='restore' ? '恢复' : '修复'}</Button></div>
    </DialogContent></Dialog>
    <ProjectUploadDialog open={upload} projectId={projectId} disabledReason={reason} onClose={()=>setUpload(false)} onUploaded={changed}/>
  </div>
}
