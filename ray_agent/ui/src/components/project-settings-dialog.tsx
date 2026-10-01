'use client'
import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import type {ProjectUpdate} from '@/lib/api/types'

export function ProjectSettingsDialog({id, onClose, onSaved}: {id: string | null; onClose: () => void; onSaved: () => void}) {
  const [settings, setSettings] = useState<ProjectUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    setSettings(null); setError(null)
    if (!id) return
    let active = true
    projectApi.detail(id).then(project => {if (active) setSettings({name: project.name, instructions: project.instructions, settings_version: project.settings_version, notes: project.notes, notes_version: project.notes_version})})
      .catch(err => {if (active) setError(err instanceof Error ? err.message : '读取设置失败')})
    return () => {active = false}
  }, [id, reload])
  const save = async () => {
    if (!id || !settings || saving) return
    setSaving(true); setError(null)
    try {await projectApi.update(id, settings); onSaved(); onClose()}
    catch (err) {setError(err instanceof Error ? err.message : '保存设置失败')}
    finally {setSaving(false)}
  }
  return <Dialog open={!!id} onOpenChange={open => {if (!open) onClose()}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
    <DialogHeader><DialogTitle>项目设置</DialogTitle><DialogDescription>每次新运行读取说明与笔记。运行中修改会在下一次运行生效；等待回复后的续接保留原设置。</DialogDescription></DialogHeader>
    {settings ? <form className="space-y-3" onSubmit={event => {event.preventDefault(); void save()}}>
      <label className="block text-sm">项目名称<input className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={160} required value={settings.name} onChange={e => setSettings({...settings, name: e.target.value})}/></label>
      <label className="block text-sm">项目说明<textarea className="mt-1 block min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={settings.instructions ?? ''} onChange={e => setSettings({...settings, instructions: e.target.value || null})}/></label>
      <label className="block text-sm">项目笔记<span className="ml-2 text-meta text-faint">版本 {settings.notes_version}</span><textarea className="mt-1 block min-h-36 w-full rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={settings.notes} onChange={e => setSettings({...settings, notes: e.target.value})}/></label>
      <p className="text-meta text-faint">{settings.notes.length} / 8000 字符。保存会整体替换笔记。</p>
      <Button disabled={saving || !settings.name.trim()} type="submit">{saving ? '正在保存' : '保存设置'}</Button>
    </form> : !error && <p className="text-meta text-faint">正在读取设置</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-meta text-state-failed">{error}</p><Button variant="outline" disabled={saving} onClick={() => {if (!settings || window.confirm('重新加载会放弃当前未保存的修改，是否继续？')) setReload(value => value + 1)}}>重新加载设置</Button></div>}
  </DialogContent></Dialog>
}
