'use client'
import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {projectApi} from '@/lib/api/project'
import type {ProjectSettings} from '@/lib/api/types'

export function ProjectSettingsDialog({id, onClose, onSaved}: {id: string | null; onClose: () => void; onSaved: () => void}) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setSettings(null); setError(null)
    if (!id) return
    let active = true
    projectApi.detail(id).then(project => {if (active) setSettings({name: project.name, instructions: project.instructions, git_author_name: project.git_author_name, git_author_email: project.git_author_email})})
      .catch(err => {if (active) setError(err instanceof Error ? err.message : '读取设置失败')})
    return () => {active = false}
  }, [id])
  const save = async () => {
    if (!id || !settings || saving) return
    setSaving(true); setError(null)
    try {await projectApi.update(id, settings); onSaved(); onClose()}
    catch (err) {setError(err instanceof Error ? err.message : '保存设置失败')}
    finally {setSaving(false)}
  }
  return <Dialog open={!!id} onOpenChange={open => {if (!open) onClose()}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
    <DialogHeader><DialogTitle>项目设置</DialogTitle><DialogDescription>说明与 Git 身份仅影响之后首次启动的对话，已有对话沿用原设置。</DialogDescription></DialogHeader>
    {settings ? <form className="space-y-3" onSubmit={event => {event.preventDefault(); void save()}}>
      <label className="block text-sm">项目名称<input className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={160} required value={settings.name} onChange={e => setSettings({...settings, name: e.target.value})}/></label>
      <label className="block text-sm">项目说明<textarea className="mt-1 block min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={settings.instructions ?? ''} onChange={e => setSettings({...settings, instructions: e.target.value || null})}/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Git 姓名<input className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={120} value={settings.git_author_name ?? ''} onChange={e => setSettings({...settings, git_author_name: e.target.value || null})}/></label><label className="text-sm">Git 邮箱<input type="email" className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={320} value={settings.git_author_email ?? ''} onChange={e => setSettings({...settings, git_author_email: e.target.value || null})}/></label></div>
      <p className="text-xs text-faint">姓名与邮箱需同时填写；这不是认证或推送凭据。</p>
      <Button disabled={saving || !settings.name.trim()} type="submit">{saving ? '正在保存' : '保存设置'}</Button>
    </form> : !error && <p className="text-meta text-faint">正在读取设置</p>}
    {error && <p role="alert" className="text-meta text-state-failed">{error}</p>}
  </DialogContent></Dialog>
}
