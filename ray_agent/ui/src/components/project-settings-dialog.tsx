'use client'
import {useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {DataCleanupDialog} from './data-cleanup-dialog'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectDetails} from '@/lib/api/types'

/** 名称与项目记忆独立保存。 */
export function ProjectSettingsDialog({id, onClose, onSaved}: {id:string|null; onClose:()=>void; onSaved:()=>void}) {
  const router = useRouter()
  const [deleting,setDeleting] = useState(false)
  const [project,setProject]=useState<ProjectDetails|null>(null),[name,setName]=useState('')
  const [error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false),[reload,setReload]=useState(0)
  const epoch=useRef(0),dirty=!!project && name!==project.name
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
    try {const updated=await projectApi.update(id,{name:name.trim(),instructions:project.instructions,settings_version:project.settings_version});if(token===epoch.current){setProject(updated);onSaved()}}
    catch(error){if(token===epoch.current){setError(error instanceof Error?error.message:'保存失败，草稿已保留');if(error instanceof ApiError && error.code===409){const latest=await projectApi.detail(id).catch(()=>null);if(latest && token===epoch.current){setProject(latest);setError(`设置已更新，最新名称为“${latest.name}”。你的名称草稿已保留，确认后可再次保存。`)}}}}
    finally{if(token===epoch.current)setSaving(false)}
  }
  return <><Dialog open={!!id} onOpenChange={value=>{if(!value)close()}}><DialogContent className="sm:max-w-[480px]"><DialogHeader><DialogTitle>项目设置</DialogTitle><DialogDescription>管理名称与项目生命周期。</DialogDescription></DialogHeader>
    {project && <form className="space-y-4" onSubmit={event=>{event.preventDefault();void save()}}><label className="block text-sm">项目名称<input className="mt-2 w-full rounded-md border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={160} required value={name} disabled={saving} onChange={event=>setName(event.target.value)}/></label><div className="flex gap-2"><Button disabled={saving || !name.trim() || !dirty} type="submit">{saving?'正在保存':'保存名称'}</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>关闭</Button></div></form>}
    {project && <><div className="flex gap-4 text-sm"><Link href={`/projects/${project.id}#instructions`} onClick={event => {if(dirty){event.preventDefault();setError('请先保存或撤销名称修改')}else close()}} className="text-signal underline">项目说明</Link><Link href={`/projects/${project.id}#notes`} onClick={event => {if(dirty){event.preventDefault();setError('请先保存或撤销名称修改')}else close()}} className="text-signal underline">项目笔记</Link></div><div className="space-y-3 border-t pt-4"><p className="text-sm">{project.archived ? '项目已归档，历史内容保留。' : '归档后从常用列表移走，历史内容保留。'}</p><Button variant="outline" disabled={saving} onClick={async () => {setSaving(true);try {const updated=await projectApi.archive(project.id,!project.archived);setProject(updated);onSaved()} catch(error) {setError(error instanceof Error ? error.message : '操作失败')} finally {setSaving(false)}}}>{project.archived ? '取消归档' : '归档项目'}</Button></div><div className="space-y-2 border-t pt-4"><p className="text-sm font-semibold text-destructive">危险操作</p><p className="text-sm text-muted-foreground">永久删除项目及其所属数据，无法恢复。</p><Button variant="outline" className="text-destructive hover:text-destructive" disabled={saving || dirty} onClick={() => setDeleting(true)}>删除项目</Button></div></>}
    {!project && !error && <p className="text-meta text-faint">正在读取设置</p>}{error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p><Button variant="outline" disabled={saving} onClick={()=>{if(!dirty || window.confirm('重新加载会放弃名称草稿，是否继续？'))setReload(value=>value+1)}}>重新加载</Button></div>}
  </DialogContent></Dialog><DataCleanupDialog open={deleting && !!id} projectId={id || undefined} onClose={() => setDeleting(false)} onCompleted={() => {setDeleting(false);onClose();onSaved();router.replace('/')}}/></>
}
