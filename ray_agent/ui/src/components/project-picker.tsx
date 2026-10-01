'use client'

import {useCallback, useEffect, useState} from 'react'
import {Folder, Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import type {ProjectView} from '@/lib/api/types'
import {toast} from 'sonner'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'

export type ProjectPickerProps = {
  enabled?: boolean; selected?: ProjectView | null; onSelect: (project: ProjectView | null) => void
  open?: boolean; onOpenChange?: (open: boolean) => void; disabled?: boolean; className?: string
  hideTrigger?: boolean; onChanged?: () => void
}

/** 打开托管项目；新建只创建项目，发送时才创建对话。 */
export function ProjectPicker({onSelect, open: controlled, onOpenChange, disabled, className, hideTrigger, onChanged}: ProjectPickerProps) {
  const [internal, setInternal] = useState(false)
  const open = controlled ?? internal
  const setOpen = onOpenChange ?? setInternal
  const [items, setItems] = useState<ProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [archived, setArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploadFolder,setUploadFolder]=useState(false)
  const [name, setName] = useState('')
  const load = useCallback(async (append = false) => {
    setLoading(true); setError(null)
    try {
      const result = await projectApi.list(archived, append ? items.length : 0)
      setItems(old => append ? [...old, ...result.projects] : result.projects); setTotal(result.total)
    } catch (err) {setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {setLoading(false)}
  }, [archived, items.length])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(null); setCreating(false)
    projectApi.list(archived).then(result => {if (active) {setItems(result.projects); setTotal(result.total)}})
      .catch(err => {if (active) setError(err instanceof Error ? err.message : '读取项目失败')})
      .finally(() => {if (active) setLoading(false)})
    return () => {active = false}
  }, [open, archived])
  const pick = (item: ProjectView) => {onSelect(item); setOpen(false)}
  const create = async () => {
    if (!name.trim() || saving) return
    setSaving(true); setError(null)
    try {const item = await projectApi.create(name.trim()); onChanged?.(); pick(item)}
    catch (err) {setError(err instanceof Error ? err.message : '新建项目失败')}
    finally {setSaving(false)}
  }
  const restore = async (item: ProjectView) => {
    setSaving(true)
    try {const restored = await projectApi.archive(item.id, false); onChanged?.(); pick(restored)}
    catch (err) {toast.error(err instanceof Error ? err.message : '恢复项目失败')}
    finally {setSaving(false)}
  }
  return <>
    {!hideTrigger && <Button type="button" variant="outline" size="sm" disabled={disabled} className={className} onClick={() => setOpen(true)}><Folder className="size-3.5"/>打开项目</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-[480px]">
      <DialogHeader><DialogTitle>打开项目</DialogTitle><DialogDescription>项目保留材料、产出和对话历史。上传的是本地文件的副本。</DialogDescription></DialogHeader>
      <div className="flex gap-2"><Button size="sm" variant={!archived ? 'secondary' : 'ghost'} onClick={() => setArchived(false)}>项目</Button><Button size="sm" variant={archived ? 'secondary' : 'ghost'} onClick={() => setArchived(true)}>已归档</Button></div>
      <div className="max-h-[40vh] overflow-y-auto">
        {items.map(item => <div key={item.id} className="flex items-center gap-2 border-b py-1">
          <button type="button" className="min-w-0 flex-1 rounded-sm px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => pick(item)}><span className="block truncate text-sm">{item.name}</span>{!item.available && <span className="block text-xs text-state-failed">{item.reason ?? '项目存储不可用'}</span>}</button>
          {archived && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void restore(item)}>恢复</Button>}
        </div>)}
        {!loading && !error && items.length === 0 && <p className="py-6 text-center text-meta text-faint">{archived ? '没有已归档项目' : '还没有项目，可新建项目'}</p>}
        {items.length < total && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}>加载更多</Button>}
      </div>
      {creating ? <form className="flex gap-2 border-t pt-3" onSubmit={event => {event.preventDefault(); void create()}}>
        <input aria-label="项目名称" required maxLength={160} className="min-w-0 flex-1 rounded-sm border bg-background px-2 text-sm" value={name} onChange={event => setName(event.target.value)}/>
        <Button size="sm" disabled={saving || !name.trim()} type="submit">{saving ? '正在创建' : '创建并打开'}</Button>
      </form> : <Button size="sm" variant="outline" onClick={() => {setCreating(true); setName(''); setError(null)}}>新建项目</Button>}
      <Button size="sm" variant="outline" disabled={saving} onClick={()=>setUploadFolder(true)}>从文件夹创建</Button>
      {loading && <p className="flex items-center gap-2 text-meta text-faint"><Loader2 className="size-4 animate-spin"/>正在读取</p>}
      {error && <p role="alert" className="text-meta text-state-failed">{error}<Button variant="ghost" size="sm" onClick={() => void load()}>重试</Button></p>}
    </DialogContent></Dialog>
    <ProjectUploadDialog open={uploadFolder} onClose={()=>setUploadFolder(false)} onCreated={project=>{onChanged?.();pick(project)}}/>
  </>
}
