'use client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {ProjectUploadTree} from '@/components/project-upload-tree'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectDetails, ProjectOperationResult, ProjectUploadPreflight, ProjectUploadRules} from '@/lib/api/types'
import {chooseProjectFolder, isActiveUploadBatch, scanProjectUpload, sourcesFromDrop, sourcesFromFiles, uploadSelection, type UploadScan, type UploadSource} from '@/lib/project-upload'
import {formatBytes} from '@/components/run/format'

type Props = {open: boolean; projectId?: string; disabledReason?: string | null; onClose: () => void; onUploaded?: () => void; onCreated?: (project: ProjectDetails) => void}
const batchKey = (id: string) => `rayagent:project-upload:${id}`
const message = (error: unknown) => error instanceof Error ? error.message : '上传失败，请读回批次结果'

export function ProjectUploadDialog({open, projectId, disabledReason, onClose, onUploaded, onCreated}: Props) {
  const [rules,setRules]=useState<ProjectUploadRules | null>(null)
  const [scan,setScan]=useState<UploadScan | null>(null)
  const [preflight,setPreflight]=useState<ProjectUploadPreflight | null>(null)
  const [confirmed,setConfirmed]=useState<Set<string>>(new Set())
  const [overwrite,setOverwrite]=useState<Set<string>>(new Set())
  const [error,setError]=useState<string | null>(null)
  const [busy,setBusy]=useState<'scan' | 'upload' | 'readback' | null>(null)
  const [progress,setProgress]=useState('')
  const [result,setResult]=useState<ProjectOperationResult | null>(null)
  const [operation,setOperation]=useState<string | null>(null)
  const [target,setTarget]=useState(projectId)
  const [name,setName]=useState('本地材料')
  const [sourceName,setSourceName]=useState('所选材料')
  const [folderFallback,setFolderFallback]=useState(false)
  const [created,setCreated]=useState<ProjectDetails | null>(null)
  const [creationUnknown,setCreationUnknown]=useState(false)
  const [onlyFailed,setOnlyFailed]=useState<Set<string> | undefined>()
  const sources=useRef<UploadSource[]>([]), epoch=useRef(0), cancel=useRef(false), transferring=useRef(false)
  const filesInput=useRef<HTMLInputElement>(null), folderInput=useRef<HTMLInputElement>(null)
  const readback=useCallback(async (id: string, op: string) => {
    const token=epoch.current
    const value=await projectApi.operation(id,op);if(token===epoch.current){setResult(value);setOperation(op)}return value
  },[])
  useEffect(() => {
    if (!open) return
    let live=true
    const epochCounter=epoch
    setError(null);setBusy(null);setProgress('');setTarget(projectId);setCreated(null);setScan(null);setPreflight(null);setResult(null);setOperation(null);setConfirmed(new Set());setOverwrite(new Set());setOnlyFailed(undefined);setCreationUnknown(false);setSourceName('所选材料');setName('本地材料')
    sources.current=[]
    projectApi.uploadRules().then(value => {if(live)setRules(value)}).catch(error => {if(live)setError(message(error))})
    if(projectId) {const op=localStorage.getItem(batchKey(projectId));if(op)void readback(projectId,op).catch(error => {if(live)setError(message(error))})}
    return () => {live=false;epochCounter.current++;cancel.current=true}
  },[open,projectId,readback])

  const inspect=async (input: UploadSource[], nextConfirmed=new Set<string>(), nextOverwrite=new Set<string>(), only?: Set<string>) => {
    const token=++epoch.current;setBusy('scan');setError(null);setPreflight(null);setResult(null);setOnlyFailed(only)
    try {
      const current=await projectApi.uploadRules()
      if(token!==epoch.current)return
      if(rules && rules.version!==current.version && nextConfirmed.size) {nextConfirmed=new Set();nextOverwrite=new Set();setError('上传规则已变化，可选项与覆盖项已清除，请重新确认')}
      setRules(current);sources.current=input;setConfirmed(new Set(nextConfirmed));setOverwrite(new Set(nextOverwrite))
      const scanned=await scanProjectUpload(input,current,nextConfirmed,path => {if(token===epoch.current)setProgress(path)},() => token!==epoch.current)
      if(token!==epoch.current)return
      setScan(scanned)
      if(scanned.errors.length || !scanned.files.length)return
      if(target) {const checked=await projectApi.preflight(target,uploadSelection(scanned,current,nextOverwrite,only));if(token===epoch.current)setPreflight(checked)}
    } catch(error) {if(token===epoch.current)setError(message(error))}
    finally {if(token===epoch.current){setBusy(null);setProgress('')}}
  }
  const folder=async () => {
    setError(null)
    try {const chosen=await chooseProjectFolder();if(chosen){setName(chosen.name);setSourceName(chosen.name);void inspect(chosen.sources)}else{
      setFolderFallback(true)
    }} catch(error) {
      if(error instanceof DOMException && error.name==='AbortError')return
      if(error instanceof DOMException && (error.name==='NotAllowedError' || error.name==='SecurityError')){setFolderFallback(true);return}
      setError(message(error))
    }
  }
  const optional=(path: string, checked: boolean) => {const next=new Set(confirmed);if(checked)next.add(path);else next.delete(path);void inspect(sources.current,next,overwrite,onlyFailed)}
  const setCover=(path: string, checked: boolean) => {const next=new Set(overwrite);if(checked)next.add(path);else next.delete(path);setOverwrite(next)}
  const upload=async () => {
    if(!rules || !scan || busy || disabledReason || creationUnknown)return
    setBusy('upload');setError(null);cancel.current=false;transferring.current=true
    let id=target, op: string | null=null
    try {
      if(!id) {
        try {const project=await projectApi.create(name.trim());id=project.id;setTarget(id);setCreated(project)}
        catch(error) {if(!(error instanceof ApiError) || error.code>=500 || error.code===408)setCreationUnknown(true);throw error}
      }
      const selection=uploadSelection(scan,rules,overwrite,onlyFailed)
      const checked=await projectApi.preflight(id,selection);setPreflight(checked)
      if(checked.errors.length || checked.items.some(item => !item.included || (item.conflict && !item.overwrite))) throw new Error('检查结果发生变化，请核对冲突和限制后重新确认')
      if(preflight && JSON.stringify(checked.fingerprint)!==JSON.stringify(preflight.fingerprint)) throw new Error('项目文件已变化，请核对最新冲突后重新确认上传')
      selection.fingerprint=checked.fingerprint
      const started=await projectApi.startUpload(id,selection);op=started.operation_id
      setOperation(op);localStorage.setItem(batchKey(id),op);setResult(started)
      for(const [index,item] of selection.items.entries()) {
        if(cancel.current)break
        setProgress(`${index+1} / ${selection.items.length} · ${item.path}`)
        if(checked.items.find(value => value.path===item.path)?.reuse)continue
        const source=scan.files.find(value => value.path===item.path)!
        try {await projectApi.uploadItem(id,op,item.path,source.file)}catch(error) {
          if(error instanceof ApiError && error.code<500 && error.code!==408)continue
          // 网络未知先读回，不盲目重传副本；断线时保留批次，提供读回和取消。
          const value=await readback(id,op)
          if(!value.results.received?.[item.path]?.published)throw error
        }
      }
      const finished=await projectApi.finishUpload(id,op,cancel.current);setResult(finished);onUploaded?.()
    } catch(error) {
      setError(message(error))
      if(id) {
        try {const detail=await projectApi.detail(id);if(!op && (!(error instanceof ApiError) || error.code>=500 || error.code===408) && detail.file_operation?.kind==='upload'){
          op=detail.file_operation.operation_id;setOperation(op);localStorage.setItem(batchKey(id),op)
        }if(op)await readback(id,op)}catch{/* 读回不可达时维持未知状态，不自动开始新批次。 */}
      }
    } finally {setBusy(null);setProgress('');transferring.current=false;onUploaded?.()}
  }
  const cancelBatch=async () => {
    cancel.current=true
    if(transferring.current){setError('正在停止后续上传；当前文件结束后取消批次，已发布文件保留');return}
    if(!target || !operation)return
    setBusy('readback');setError(null)
    try {setResult(await projectApi.finishUpload(target,operation,true));onUploaded?.()}catch(error){setError(message(error))}finally{setBusy(null)}
  }
  const retry=async () => {
    if(!scan || !result)return
    const failures=new Set(scan.files.filter(file => !result.results.received?.[file.path]?.published).map(file => file.path))
    if(!failures.size)return
    if(result.state==='running' && target && operation)await cancelBatch()
    void inspect(sources.current,confirmed,new Set(),failures)
  }
  const close=() => {
    if(busy==='upload'){setError('批次尚在上传。请先取消批次，已发布文件会保留');return}
    epoch.current++
    if(created)onCreated?.(created)
    onClose()
  }
  const unresolved=preflight?.items.some(item => item.conflict && !overwrite.has(item.path))
  const optionalRows=scan ? [...scan.excluded,...[...confirmed].filter(path => !scan.excluded.some(item => item.path===path)).map(path => ({path,policy:'optional' as const,reason:'已确认上传；取消勾选可排除',size:scan.files.filter(item => item.path===path || item.path.startsWith(path+'/')).reduce((sum,item) => sum+item.file.size,0),directory:!scan.files.some(item => item.path===path)}))] : []
  const totalBytes=scan?.files.reduce((sum,item) => sum+item.file.size,0) || 0
  const activeBatch=isActiveUploadBatch(result)
  const uploadComplete=result?.results.batch_status==='completed'
  return <Dialog open={open} onOpenChange={value => {if(!value)close()}}><DialogContent className="flex h-[calc(100dvh-24px)] max-h-[880px] max-w-[calc(100%-24px)] flex-col gap-3 overflow-hidden p-4 font-normal sm:h-[80dvh] sm:max-w-[min(960px,calc(100%-48px))] sm:p-5">
    <DialogHeader className="shrink-0 pr-7 text-left"><DialogTitle>{projectId ? '上传项目文件' : '从文件夹创建项目'}</DialogTitle><DialogDescription>上传的是副本，本地文件不会自动同步。空文件夹不保留；覆盖前会保存保护快照。</DialogDescription></DialogHeader>
    {!projectId && !target && <label className="shrink-0 text-sm">项目名称<input className="mt-1 w-full rounded-md border bg-background px-3 py-2" maxLength={160} value={name} onChange={event => setName(event.target.value)}/></label>}
    <div className={scan ? 'flex shrink-0 flex-wrap items-center gap-2' : 'flex min-h-28 shrink-0 flex-wrap items-center justify-center gap-2 rounded-md border border-dashed p-3'} onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault();if(!busy && !disabledReason && !activeBatch)void inspect(sourcesFromDrop(event.dataTransfer.items))}}>
      <span className="min-w-0 flex-1 truncate text-meta text-faint">{scan ? `来源：${sourceName}` : '拖入文件或文件夹，或选择本地材料'}</span><Button size="sm" variant="outline" disabled={!!busy || !!disabledReason || !!activeBatch} onClick={() => filesInput.current?.click()}>选择文件</Button><Button size="sm" variant="outline" disabled={!!busy || !!disabledReason || !!activeBatch} onClick={() => void folder()}>选择文件夹</Button>
      <input ref={filesInput} type="file" multiple className="hidden" onChange={event => {const files=Array.from(event.target.files || []);event.target.value='';void inspect(sourcesFromFiles(files))}}/>
      <input ref={element => {folderInput.current=element;element?.setAttribute('webkitdirectory','')}} type="file" multiple className="hidden" {...{webkitdirectory: ''}} onChange={event => {const files=Array.from(event.target.files || []);event.target.value='';if(files.length){setName(files[0].webkitRelativePath.split('/')[0]);setSourceName(files[0].webkitRelativePath.split('/')[0])};void inspect(sourcesFromFiles(files,true))}}/>
    </div>
    {disabledReason && <p className="text-meta text-state-waiting">{disabledReason}</p>}
    {busy && <p role="status" className="truncate text-meta text-faint">{busy==='scan' ? '正在扫描与预检' : busy==='upload' ? '正在上传' : '正在读取批次'}：{progress}</p>}
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
    {scan ? <ProjectUploadTree scan={scan} optionalRows={optionalRows} confirmed={confirmed} overwrite={overwrite} preflight={preflight} result={result} onlyFailed={onlyFailed} disabled={!!busy || activeBatch || uploadComplete} sourceName={sourceName} onOptional={optional} onOverwrite={setCover}/> : <div className="flex min-h-24 flex-1 items-center justify-center rounded-md border bg-muted/20 p-5 text-center text-meta text-faint">选择材料后，在这里审核文件层级、大小与上传规则</div>}
    {scan && <div className="max-h-28 shrink-0 overflow-y-auto text-meta">
      {preflight?.warnings.map(item => <p key={item.path} className="text-state-waiting">{item.path} 与 {item.case_conflicts.join('、')} 仅大小写不同，下载到 macOS 或 Windows 时可能冲突。</p>)}
      {scan.errors.map((text,index) => <p role="alert" key={index} className="text-state-failed">{text}</p>)}{preflight?.errors.map(text => <p role="alert" key={text} className="text-state-failed">{text}</p>)}
    </div>}
    {result && <div className="max-h-40 shrink-0 space-y-2 overflow-y-auto border-t pt-3 text-meta"><p>批次结果：{({completed:'完成',partial_failure:'部分失败',failed:'失败',expired:'已到期',interrupted:'已中断',cancelled:'已取消',uploading:'上传中'} as Record<string,string>)[result.results.batch_status || ''] || result.results.batch_status || result.state}</p>
      {Object.entries(result.results.received || {}).map(([path,item]) => <p key={path} className="break-all">{path}：{item.published ? item.reused ? '已复用' : '已发布' : item.error || '未发布'}</p>)}
      {Object.entries(result.results.failures || {}).map(([path,error]) => <p key={path} className="break-all text-state-failed">{path}：{error}</p>)}
      {result.error && <p className="text-state-failed">{result.error}</p>}
      {target && operation && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => {setBusy('readback');void readback(target,operation).catch(error => setError(message(error))).finally(() => setBusy(null))}}>读回批次结果</Button>}
      {activeBatch && <Button size="sm" variant="outline" onClick={() => void cancelBatch()}>取消批次</Button>}
      {scan && !activeBatch && scan.files.some(item => !result.results.received?.[item.path]?.published) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void retry()}>重新预检失败项</Button>}
      {!scan && <p className="text-faint">重试失败项需重新选择本地材料；已发布的相同路径与内容会复用。</p>}
    </div>}
    {error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
    {creationUnknown && <p className="text-meta text-state-waiting">新建项目的受理结果未知，请关闭弹框，刷新项目列表后选择已创建的项目。不要重复新建。</p>}
    </div>
    <div className="shrink-0 border-t pt-3">
      {scan && <p className="mb-2 text-meta">{uploadComplete ? '已上传' : '将上传'} {scan.files.filter(item => !onlyFailed || onlyFailed.has(item.path)).length} 个文件，{formatBytes(onlyFailed ? scan.files.filter(item => onlyFailed.has(item.path)).reduce((sum,item) => sum+item.file.size,0) : totalBytes)}；排除 {scan.excluded.length} 项{preflight && `；上传后项目 ${formatBytes(preflight.projected_bytes)}`}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs text-muted-foreground" role="status">{uploadComplete ? '上传完成，文件副本已保存在项目中' : disabledReason || (busy ? '请等待当前操作完成' : unresolved ? '请在文件详情中确认同名覆盖' : scan?.errors.length || preflight?.errors.length ? '请先处理检查错误' : creationUnknown ? '请读回项目创建结果' : activeBatch ? '请读回或取消当前批次' : !scan?.files.length ? '请选择可上传的材料' : !target && !name.trim() ? '请填写项目名称' : '确认前不会写入项目')}</p>
        <Button variant="outline" onClick={() => busy==='upload' ? void cancelBatch() : close()}>{busy==='upload' ? '取消批次' : '关闭'}</Button>
        {uploadComplete ? <Button onClick={close}>完成</Button> : <Button disabled={!scan?.files.length || !!busy || !!disabledReason || !!scan.errors.length || !!preflight?.errors.length || !!unresolved || !!activeBatch || creationUnknown || (!target && !name.trim())} onClick={() => void upload()}>{target ? '确认上传' : '创建项目并上传'}</Button>}
      </div>
    </div>
    <Dialog open={folderFallback && open} onOpenChange={setFolderFallback}><DialogContent>
      <DialogHeader><DialogTitle>浏览器文件夹选择</DialogTitle><DialogDescription>此浏览器会先列出文件夹内全部文件，大型依赖目录可能明显变慢。确认后继续选择文件夹。</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setFolderFallback(false)}>取消</Button><Button onClick={()=>{folderInput.current?.setAttribute('webkitdirectory','');setFolderFallback(false);folderInput.current?.click()}}>继续选择文件夹</Button></div>
    </DialogContent></Dialog>
  </DialogContent></Dialog>
}
