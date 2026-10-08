'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {Folder, Loader2} from 'lucide-react'
import {ImportFolderIcon} from '@/components/nav-icons'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {ApiError} from '@/lib/api/fetch'
import {projectApi} from '@/lib/api/project'
import type {ProjectView} from '@/lib/api/types'
import {toast} from 'sonner'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'

export type ProjectPickerProps = {
  mode?: 'create' | 'archived'; enabled?: boolean; selected?: ProjectView | null; onSelect: (project: ProjectView | null) => void
  open?: boolean; onOpenChange?: (open: boolean) => void; disabled?: boolean; className?: string
  hideTrigger?: boolean; onChanged?: () => void
}

/** 选择或新建托管项目。打开后由调用方进入该项目的新对话。 */
export function ProjectPicker({mode, onSelect, open: controlled, onOpenChange, disabled, className, hideTrigger, onChanged}: ProjectPickerProps) {
  const [internal, setInternal] = useState(false)
  const open = controlled ?? internal
  const setOpen = onOpenChange ?? setInternal
  const [items, setItems] = useState<ProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [archived, setArchived] = useState(mode === 'archived')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false),[unknown,setUnknown]=useState(false)
  const [uploadFolder,setUploadFolder]=useState(false)
  const [name, setName] = useState('')
  const request = useRef(0)
  const creationId=useRef<string|null>(null)
  const load = useCallback(async (append = false) => {
    const current = ++request.current
    setLoading(true); setError(null)
    try {
      const result = await projectApi.list(archived, append ? items.length : 0)
      if (current !== request.current) return
      setItems(old => append ? [...old, ...result.projects] : result.projects); setTotal(result.total)
    } catch (err) {if (current === request.current) setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {if (current === request.current) setLoading(false)}
  }, [archived, items.length])
  useEffect(() => {
    if (!open) return
    const current = ++request.current
    const counter = request
    setLoading(true); setError(null); setUnknown(false); setCreating(mode === 'create')
    if (mode === 'create') {setLoading(false); setName('');creationId.current=null; return () => {counter.current++}}
    projectApi.list(archived).then(result => {if (current === counter.current) {setItems(result.projects); setTotal(result.total)}})
      .catch(err => {if (current === counter.current) setError(err instanceof Error ? err.message : '读取项目失败')})
      .finally(() => {if (current === counter.current) setLoading(false)})
    return () => {counter.current++}
  }, [open, archived, mode])
  const switchSection = (value: boolean) => {
    if (value === archived) return
    request.current++
    setItems([]); setTotal(0); setError(null); setLoading(true); setArchived(value)
  }
  const pick = (item: ProjectView) => {onSelect(item); setOpen(false)}
  const create = async () => {
    if (!name.trim() || saving) return
    setSaving(true); setError(null)
    try {const item = await projectApi.create(name.trim(),undefined,creationId.current ?? (creationId.current=crypto.randomUUID())); onChanged?.(); pick(item)}
    catch (err) {setUnknown(!(err instanceof ApiError && err.code>=400 && err.code<500 && err.code!==408));setError(err instanceof Error ? err.message : '新建项目失败')}
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
      <DialogHeader><DialogTitle>{mode === 'create' ? '新建项目' : mode === 'archived' ? '已归档项目' : '项目'}</DialogTitle><DialogDescription>项目保留材料、产出和对话历史。上传的是本地文件的副本。</DialogDescription></DialogHeader>
      {!mode && <div className="flex gap-2"><Button size="sm" variant={!archived ? 'secondary' : 'ghost'} onClick={() => switchSection(false)}>项目</Button><Button size="sm" variant={archived ? 'secondary' : 'ghost'} onClick={() => switchSection(true)}>已归档</Button></div>}
      {mode !== 'create' && <div className="max-h-[40vh] overflow-y-auto">
        {items.map(item => <div key={item.id} className="flex items-center gap-2 border-b py-1">
          <button type="button" className="min-w-0 flex-1 rounded-sm px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => pick(item)}><span className="block truncate text-sm">{item.name}</span><span className="block text-meta text-faint">{item.task_count ?? 0} 段对话{item.last_active_at ? ` · ${new Date(item.last_active_at).toLocaleDateString()}` : ''}</span>{!item.available && <span className="block text-xs text-state-failed">{item.reason ?? '项目存储不可用'}</span>}</button>
          {archived && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void restore(item)}>恢复</Button>}
        </div>)}
        {!loading && !error && items.length === 0 && <p className="py-6 text-center text-meta text-faint">{archived ? '没有已归档项目' : '项目会保留材料、产出与记忆。创建空白项目，或从文件夹导入材料'}</p>}
        {items.length < total && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}>加载更多</Button>}
      </div>}
      {mode !== 'archived' && (creating ? <form className="flex items-end gap-2 border-t pt-3" onSubmit={event => {event.preventDefault(); void create()}}>
        <label className="min-w-0 flex-1 text-sm font-normal">项目名称<input aria-label="项目名称" placeholder="例如：季度研究" required maxLength={160} className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" disabled={saving || unknown} value={name} onChange={event => setName(event.target.value)}/></label>
        <Button size="sm" disabled={saving || !name.trim()} type="submit">{saving ? unknown?'正在检查':'正在创建' : unknown?'检查创建结果':'创建并打开'}</Button>
<Button size="sm" type="button" variant="outline" disabled={saving} onClick={()=>{setCreating(false);setError(null);if(mode==='create')setOpen(false)}}>取消</Button>
      </form> : <Button size="sm" variant="outline" onClick={() => {setCreating(true); setName('');creationId.current=null; setError(null)}}>新建项目</Button>)}
      {!mode && <Button size="sm" variant="outline" disabled={saving} onClick={()=>setUploadFolder(true)}><ImportFolderIcon aria-hidden="true"/>从文件夹创建</Button>}
      {loading && <p className="flex items-center gap-2 text-meta text-faint"><Loader2 className="size-4 animate-spin"/>正在读取</p>}
      {unknown && <p className="text-meta text-state-waiting">创建结果尚未确认，使用原创建标识检查结果，不会新建第二个项目。</p>}{error && <p role="alert" className="text-meta text-state-failed">{error}<Button variant="ghost" size="sm" onClick={() => creating ? void create() : void load()}>重试</Button></p>}
    </DialogContent></Dialog>
    <ProjectUploadDialog open={uploadFolder} onClose={()=>setUploadFolder(false)} onCreated={project=>{onChanged?.();pick(project)}}/>
  </>
}
