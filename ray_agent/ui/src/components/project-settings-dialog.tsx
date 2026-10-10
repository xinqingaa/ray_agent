'use client'
import {useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import {DataCleanupDialog} from './data-cleanup-dialog'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectDetails} from '@/lib/api/types'

/** 名称与项目记忆独立保存。 */
export function ProjectSettingsDialog({id, onClose, onSaved, onReturnFocus}: {onReturnFocus?:()=>void;id:string|null; onClose:()=>void; onSaved:()=>void}) {
  const router = useRouter()
  const [deleting,setDeleting] = useState(false)
  const [project,setProject]=useState<ProjectDetails|null>(null),[name,setName]=useState('')
  const [error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false),[reload,setReload]=useState(0)
  const epoch=useRef(0),dirty=!!project && name.trim()!==project.name.trim()
  useEffect(()=>{
    const token=++epoch.current;setProject(null);setError(null);setSaving(false)
    if(!id)return
    projectApi.detail(id).then(value=>{if(token===epoch.current){setProject(value);setName(value.name)}}).catch(error=>{if(token===epoch.current)setError(error instanceof Error?error.message:'读取设置失败')})
    const counter=epoch;return ()=>{counter.current++}
  },[id,reload])
  useUnsavedNavigation(()=>dirty,!!id)
  const close=()=>{if(!saving && (!dirty || window.confirm('项目名称有未保存的修改，放弃修改？')))onClose()}
  const save=async()=>{
    if(!id || !project || saving || !dirty)return
    const token=epoch.current;setSaving(true);setError(null)
    try {const updated=await projectApi.update(id,{name:name.trim(),instructions:project.instructions,settings_version:project.settings_version});if(token===epoch.current){setProject(updated);setName(updated.name);onSaved();onClose()}}
    catch(error){if(token===epoch.current){setError(error instanceof Error?error.message:'保存失败，草稿已保留');if(error instanceof ApiError && error.code===409){const latest=await projectApi.detail(id).catch(()=>null);if(latest && token===epoch.current){setProject(latest);setError(`设置已更新，最新名称为“${latest.name}”。你的名称草稿已保留，确认后可再次保存。`)}}}}
    finally{if(token===epoch.current)setSaving(false)}
  }
  const archive = async () => {
    if (!project || saving || dirty) return
    setSaving(true); setError(null)
    try {await projectApi.archive(project.id,!project.archived); onSaved(); onClose()}
    catch(error) {setError(error instanceof Error ? error.message : '操作失败')}
    finally {setSaving(false)}
  }
  return <><Dialog open={!!id && !deleting} onOpenChange={value=>{if(!value)close()}}><DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[480px]" onCloseAutoFocus={event=>{if(deleting)event.preventDefault();else if(onReturnFocus){event.preventDefault();onReturnFocus()}}}>
    <DialogHeader><DialogTitle>项目设置</DialogTitle><DialogDescription className="sr-only">修改项目名称、归档或删除项目</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-5 overflow-y-auto">
      {project && <>
        <form id="project-settings-form" onSubmit={event=>{event.preventDefault();void save()}}>
          <label className="block text-sm font-medium">项目名称<input className="mt-2 w-full rounded-md border bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={160} required value={name} disabled={saving} onChange={event=>setName(event.target.value)}/></label>
        </form>
        <div className="flex items-start gap-4 border-t pt-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{project.archived ? '项目已归档' : '归档项目'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{project.archived ? '恢复到侧栏，继续使用项目。' : '从侧栏移除，保留对话、文件与记忆。'}</p></div><Button variant="outline" size="sm" disabled={saving || dirty} onClick={()=>void archive()}>{project.archived ? '取消归档' : '归档'}</Button></div>
        <div className="flex items-start gap-4 border-t pt-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-destructive">删除项目</p><p className="mt-1 text-xs leading-5 text-muted-foreground">永久删除项目及所属数据，无法恢复。</p></div><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={saving || dirty} onClick={()=>setDeleting(true)}>删除</Button></div>
        {dirty && <p className="text-xs text-muted-foreground">归档或删除前，请先保存或取消名称修改。</p>}
      </>}
      {!project && !error && <p role="status" className="text-meta text-faint">正在读取设置</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p>{!project && <Button variant="outline" onClick={()=>setReload(value=>value+1)}>重新加载</Button>}</div>}
    </div>
    <DialogFooter className="border-t pt-4"><Button variant="ghost" disabled={saving} onClick={close}>取消</Button><Button form="project-settings-form" type="submit" disabled={saving || !name.trim() || !dirty}>{saving ? '正在保存' : '保存'}</Button></DialogFooter>
  </DialogContent></Dialog><DataCleanupDialog open={deleting && !!id} projectId={id || undefined} onClose={()=>setDeleting(false)} onNavigate={()=>{setDeleting(false);onClose()}} onCompleted={()=>{setDeleting(false);onClose();onSaved();router.replace('/')}}/></>
}
