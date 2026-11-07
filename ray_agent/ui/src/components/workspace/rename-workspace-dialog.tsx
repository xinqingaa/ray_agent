import {useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {workspaceApi} from '@/lib/api/workspace'
import type {WorkspaceItem} from '@/lib/api/types'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {useWorkspaces} from '@/providers/workspaces-provider'

/** 重命名只改显示名称，不改文件夹名。 */
export function RenameWorkspaceDialog({workspace, open, onOpenChange}: {workspace: WorkspaceItem; open: boolean; onOpenChange: (open: boolean) => void}) {
  const {upsert, refresh} = useWorkspaces()
  const [name, setName] = useState(workspace.name)
  const [saving, setSaving] = useState(false)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setName(workspace.name)
    wasOpen.current = open
  }, [open, workspace.name])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    if (trimmed === workspace.name) {onOpenChange(false); return}
    setSaving(true)
    try {
      upsert(await workspaceApi.rename(workspace, trimmed))
      toast.success('已重命名')
      onOpenChange(false)
    } catch (error) {
      reportWorkspaceError(error, '重命名失败', () => void refresh())
    } finally {setSaving(false)}
  }

  return <Dialog open={open} onOpenChange={value => {if (!saving) onOpenChange(value)}}>
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>重命名工作区</DialogTitle>
        <DialogDescription>只修改在 RayAgent 中显示的名称，文件夹名称不变。</DialogDescription>
      </DialogHeader>
      <form onSubmit={event => {event.preventDefault(); void save()}}>
        <Input autoFocus value={name} maxLength={200} dir="auto" aria-label="工作区名称" disabled={saving} onChange={event => setName(event.target.value)}/>
      </form>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={!name.trim() || saving} onClick={() => void save()}>{saving ? '正在保存' : '保存'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
