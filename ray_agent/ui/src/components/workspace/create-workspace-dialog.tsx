import {useEffect, useRef, useState, type RefObject} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {FolderPlus} from '@/components/ui/icons'
import {Input} from '@/components/ui/input'
import {workspaceApi} from '@/lib/api/workspace'
import {useRouter} from '@/lib/navigation'
import {workspaceHref} from '@/lib/workspace-route'
import {useWorkspaces} from '@/providers/workspaces-provider'

/** 在默认位置新建空文件夹作为工作区；名称同时是文件夹名，重名由核心加序号。 */
export function CreateWorkspaceDialog({open, onOpenChange, returnFocus}: {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: RefObject<HTMLButtonElement | null>
}) {
  const router = useRouter()
  const {upsert} = useWorkspaces()
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState<{path: string} | {error: string} | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    setLocation(null)
    workspaceApi.defaultLocation()
      .then(path => {if (active) setLocation({path})})
      .catch(error => {if (active) setLocation({error: error instanceof Error ? error.message : '读取默认位置失败'})})
    return () => {active = false}
  }, [open, retry])

  const trimmed = name.trim()
  const path = location && 'path' in location ? location.path : null
  // Display the expected child path. The core owns validation and collision handling.
  const separator = path?.includes('\\') && !path.includes('/') ? '\\' : '/'
  const destination = path && trimmed ? `${path.replace(/[\\/]+$/, '')}${separator}${trimmed}` : path
  const submit = async () => {
    if (!trimmed || !path || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      const workspace = await workspaceApi.create(trimmed)
      upsert(workspace)
      onOpenChange(false)
      router.push(workspaceHref(workspace.id))
    } catch (error) {
      setError(error instanceof Error ? error.message : '新建工作区失败')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={value => {if (!submitting.current) onOpenChange(value)}}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] gap-8 overflow-y-auto rounded-[18px] bg-background p-6 shadow-(--paper-shadow) sm:max-w-[544px] sm:p-8"
      onOpenAutoFocus={event => {event.preventDefault(); input.current?.focus()}}
      onCloseAutoFocus={event => {
        if (returnFocus?.current) {event.preventDefault(); returnFocus.current.focus()}
      }}>
      <DialogHeader className="gap-2 pr-8 text-left">
        <DialogTitle className="flex items-center gap-3 text-xl leading-tight">
          <FolderPlus className="size-5 shrink-0 text-muted-foreground" aria-hidden/>
          新建工作区
        </DialogTitle>
        <DialogDescription className="leading-relaxed">在默认位置创建一个同名文件夹。</DialogDescription>
      </DialogHeader>
      <form className="space-y-8" onSubmit={event => {event.preventDefault(); void submit()}} aria-busy={saving}>
        <div className="space-y-4">
          <label className="grid gap-2.5 text-sm font-medium">
            <span>工作区名称</span>
            <Input className="h-12 rounded-lg px-3.5 font-normal" ref={input} value={name} maxLength={200} dir="auto" disabled={saving} placeholder="例如：季度复盘"
              aria-invalid={Boolean(error)} onChange={event => {setName(event.target.value); setError(null)}}/>
          </label>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta leading-relaxed text-muted-foreground">
            <span className="shrink-0">{trimmed ? '预计创建位置' : '默认位置'}</span>
            {destination ? <bdi className="min-w-0 flex-1 font-mono wrap-anywhere" dir="auto">{destination}</bdi>
              : location && 'error' in location ? <p className="wrap-anywhere" role="alert">{location.error}{' '}
                <Button type="button" variant="ghost" size="xs" onClick={() => setRetry(value => value + 1)}>重试</Button>
              </p> : <p role="status">正在读取…</p>}
          </div>
          {error && <p role="alert" className="text-meta wrap-anywhere text-state-failed">{error}</p>}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" size="lg" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="submit" size="lg" disabled={!trimmed || !path || saving}>{saving ? '正在创建…' : '创建工作区'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
