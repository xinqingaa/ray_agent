import {useEffect, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {workspaceApi} from '@/lib/api/workspace'
import {useRouter} from '@/lib/navigation'
import {workspaceHref} from '@/lib/workspace-route'
import {useWorkspaces} from '@/providers/workspaces-provider'

/** 在默认位置新建空文件夹作为工作区；名称同时是文件夹名，重名由核心加序号。 */
export function CreateWorkspaceDialog({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const router = useRouter()
  const {upsert} = useWorkspaces()
  const [name, setName] = useState('')
  const [location, setLocation] = useState<{path: string} | {error: string} | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setName(''); setLocation(null)
    workspaceApi.defaultLocation()
      .then(path => {if (active) setLocation({path})})
      .catch(error => {if (active) setLocation({error: error instanceof Error ? error.message : '读取默认位置失败'})})
    return () => {active = false}
  }, [open])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const workspace = await workspaceApi.create(trimmed)
      upsert(workspace)
      onOpenChange(false)
      router.push(workspaceHref(workspace.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '新建工作区失败')
    } finally {setSaving(false)}
  }

  return <Dialog open={open} onOpenChange={value => {if (!saving) onOpenChange(value)}}>
    <DialogContent className="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>新建工作区</DialogTitle>
        <DialogDescription>
          将在默认位置创建同名文件夹，之后可在设置里更改默认位置。
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={event => {event.preventDefault(); void submit()}}>
        <label className="block space-y-1.5 text-sm">
          <span>名称</span>
          <Input autoFocus value={name} maxLength={200} dir="auto" disabled={saving} placeholder="例如：季度复盘" onChange={event => setName(event.target.value)}/>
        </label>
        <p className="text-meta text-muted-foreground">
          位置：{location == null ? '正在读取…' : 'path' in location
            ? <span className="break-all font-mono text-xs">{location.path}</span>
            : <span role="alert" className="text-state-failed">{location.error}</span>}
        </p>
      </form>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={!name.trim() || saving || (location != null && 'error' in location)} onClick={() => void submit()}>{saving ? '正在创建' : '新建工作区'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
