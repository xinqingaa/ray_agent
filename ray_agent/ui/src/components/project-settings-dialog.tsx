'use client'
import {useEffect, useRef, useState} from 'react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectDetails} from '@/lib/api/types'

/** 名称与项目记忆独立保存。 */
export function ProjectSettingsDialog({id, onClose, onSaved}: {id:string|null; onClose:()=>void; onSaved:()=>void}) {
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
  return <Dialog open={!!id} onOpenChange={value=>{if(!value)close()}}><DialogContent className="sm:max-w-[480px]"><DialogHeader><DialogTitle>项目设置</DialogTitle><DialogDescription>管理项目名称。长期要求、共同笔记和近期摘要在“项目记忆”中查看与编辑。</DialogDescription></DialogHeader>
    {project && <form className="space-y-4" onSubmit={event=>{event.preventDefault();void save()}}><label className="block text-sm">项目名称<input className="mt-2 w-full rounded-md border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={160} required value={name} disabled={saving} onChange={event=>setName(event.target.value)}/></label><div className="flex gap-2"><Button disabled={saving || !name.trim() || !dirty} type="submit">{saving?'正在保存':'保存名称'}</Button><Button type="button" variant="outline" disabled={saving} onClick={close}>关闭</Button></div></form>}
    {!project && !error && <p className="text-meta text-faint">正在读取设置</p>}{error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p><Button variant="outline" disabled={saving} onClick={()=>{if(!dirty || window.confirm('重新加载会放弃名称草稿，是否继续？'))setReload(value=>value+1)}}>重新加载</Button></div>}
  </DialogContent></Dialog>
}
