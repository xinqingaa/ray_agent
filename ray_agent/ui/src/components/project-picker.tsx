'use client'

import {useCallback, useEffect, useState} from 'react'
import {ChevronLeft, Folder, Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import type {BrowseListing, ProjectRootsData, ProjectView} from '@/lib/api/types'
import {toast} from 'sonner'

export type ProjectPickerProps = {
  enabled?: boolean
  selected?: ProjectView | null
  onSelect: (project: ProjectView | null) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  className?: string
  hideTrigger?: boolean
  onChanged?: () => void
}

/** 打开长期项目；登记目录不创建会话，不可用项目仍可进入历史。 */
export function ProjectPicker({onSelect, open: controlled, onOpenChange, disabled, className, hideTrigger, onChanged}: ProjectPickerProps) {
  const [internal, setInternal] = useState(false)
  const open = controlled ?? internal
  const setOpen = onOpenChange ?? setInternal
  const [items, setItems] = useState<ProjectView[]>([])
  const [total, setTotal] = useState(0)
  const [archived, setArchived] = useState(false)
  const [roots, setRoots] = useState<ProjectRootsData | null>(null)
  const [rootsError, setRootsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [browse, setBrowse] = useState<BrowseListing | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const load = useCallback(async (append = false) => {
    setLoading(true); setError(null)
    try {
      const result = await projectApi.list(archived, append ? items.length : 0)
      setItems(old => append ? [...old, ...result.projects] : result.projects)
      setTotal(result.total)
    } catch (err) {setError(err instanceof Error ? err.message : '读取项目失败')}
    finally {setLoading(false)}
  }, [archived, items.length])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(null); setBrowsing(false); setBrowse(null); setRoots(null); setRootsError(null)
    projectApi.list(archived).then(result => {if (active) {setItems(result.projects); setTotal(result.total)}})
      .catch(err => {if (active) setError(err instanceof Error ? err.message : '读取项目失败')})
      .finally(() => {if (active) setLoading(false)})
    projectApi.getRoots().then(result => {if (active) setRoots(result)})
      .catch(err => {if (active) setRootsError(err instanceof Error ? err.message : '读取根目录失败')})
    return () => {active = false}
  }, [open, archived])
  const pick = (item: ProjectView) => {onSelect(item); setOpen(false)}
  const browsePath = async (path: string) => {
    setLoading(true); setError(null); setBrowse(null)
    try {setBrowse(await projectApi.browse(path))}
    catch (err) {setError(err instanceof Error ? err.message : '浏览目录失败')}
    finally {setLoading(false)}
  }
  const register = async () => {
    if (!browse?.path || saving) return
    setSaving(true); setError(null)
    try {const item = await projectApi.create(browse.path); onChanged?.(); pick(item)}
    catch (err) {setError(err instanceof Error ? err.message : '登记项目失败')}
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
      <DialogHeader><DialogTitle>打开项目</DialogTitle><DialogDescription>选择已登记项目，或添加允许目录中的项目。</DialogDescription></DialogHeader>
      {!browsing ? <>
        <div className="flex gap-2"><Button size="sm" variant={!archived ? 'secondary' : 'ghost'} onClick={() => setArchived(false)}>项目</Button><Button size="sm" variant={archived ? 'secondary' : 'ghost'} onClick={() => setArchived(true)}>已归档</Button></div>
        <div className="max-h-[40vh] overflow-y-auto">
          {items.map(item => <div key={item.id} className="flex items-center gap-2 border-b py-1">
            <button type="button" className="min-w-0 flex-1 rounded-sm px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => pick(item)}><span className="block truncate text-sm">{item.name}</span><span className="block truncate font-mono text-xs text-faint" title={item.path}>{item.path}</span>{!item.available && <span className="block text-xs text-state-failed">{item.reason ?? '目录不可用'}</span>}</button>
            {archived && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void restore(item)}>恢复</Button>}
          </div>)}
          {!loading && !error && items.length === 0 && <p className="py-6 text-center text-meta text-faint">{archived ? '没有已归档项目' : '还没有项目，可添加目录'}</p>}
          {items.length < total && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}>加载更多</Button>}
        </div>
        <div className="border-t pt-3">
          {rootsError ? <p role="alert" className="text-meta text-state-failed">{rootsError} <button className="underline" onClick={() => {setOpen(false); setTimeout(() => setOpen(true), 0)}}>重试</button></p> : roots && (!roots.enabled || roots.supported === false) ? <p className="text-meta text-muted-foreground">{roots.reason ?? '未配置项目根目录'}。<a className="underline" href="/settings">查看设置</a></p> : null}
          <Button size="sm" variant="outline" disabled={!roots?.enabled || roots.supported === false || loading} onClick={() => {setBrowsing(true); setBrowse(null); setError(null)}}>添加目录…</Button>
        </div>
      </> : <>
        <div className="flex min-w-0 items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label="返回" onClick={() => {if (browse?.parent) void browsePath(browse.parent); else if (browse) setBrowse(null); else setBrowsing(false)}}><ChevronLeft/></Button><span className="truncate font-mono text-xs" title={browse?.path}>{browse?.path ?? '允许的根目录'}</span></div>
        <div className="max-h-[40vh] overflow-y-auto">
          {!browse && !loading && roots?.roots.map(root => <button key={root.path} type="button" disabled={!root.available} title={root.reason ?? root.path} className="block w-full truncate rounded-sm px-2 py-2 text-left font-mono text-xs hover:bg-muted disabled:opacity-50" onClick={() => void browsePath(root.path)}>{root.path}{!root.available && ` · ${root.reason ?? '不可用'}`}</button>)}
          {browse?.entries.map(entry => <button type="button" key={entry.path} className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => void browsePath(entry.path)}><Folder className="size-4"/>{entry.name}</button>)}
          {browse && !browse.entries.length && <p className="py-5 text-meta text-faint">没有子目录</p>}
        </div>
        {browse?.truncated && <p className="text-xs text-faint">目录列表已截断，请进入更具体的目录。</p>}
        <Button disabled={!browse?.path || loading || saving} onClick={() => void register()}>{saving ? '正在登记' : '添加并打开此目录'}</Button>
      </>}
      {loading && <p className="flex items-center gap-2 text-meta text-faint"><Loader2 className="size-4 animate-spin"/>正在读取</p>}
      {error && <p role="alert" className="text-meta text-state-failed">{error}{!browsing && <Button variant="ghost" size="sm" onClick={() => void load()}>重试</Button>}</p>}
    </DialogContent></Dialog>
  </>
}
