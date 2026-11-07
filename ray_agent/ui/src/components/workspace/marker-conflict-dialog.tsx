import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import type {ConflictResolution, MarkerConflict} from '@/lib/api/types'

/** 打开的文件夹带有已知工作区的标记，但原工作区仍绑定在别处：说明两个选项的后果，由用户选择。 */
export function MarkerConflictDialog({conflict, busy, onResolve, onCancel}: {
  conflict: MarkerConflict | null
  busy: boolean
  onResolve: (resolution: ConflictResolution) => void
  onCancel: () => void
}) {
  const options = conflict?.options ?? []
  return <Dialog open={conflict != null} onOpenChange={open => {if (!open && !busy) onCancel()}}>
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>这个文件夹带有「{conflict?.workspace_name}」的标记</DialogTitle>
        <DialogDescription>
          「{conflict?.workspace_name}」仍绑定在另一个位置，看起来你选择的是它的副本。选择如何处理：
        </DialogDescription>
      </DialogHeader>
      <dl className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-meta">
        <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">原位置</dt><dd className="min-w-0 break-all font-mono text-xs">{conflict?.bound_path}</dd></div>
        <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground">所选</dt><dd className="min-w-0 break-all font-mono text-xs">{conflict?.path}</dd></div>
      </dl>
      <ul className="space-y-3 text-sm">
        {options.includes('as_new') && <li><p className="font-medium">作为新工作区</p>
          <p className="mt-0.5 text-muted-foreground">在所选文件夹创建一个独立的新工作区。「{conflict?.workspace_name}」继续留在原位置，两者的对话互不共享。</p></li>}
        {options.includes('rebind') && <li><p className="font-medium">改绑到这里</p>
          <p className="mt-0.5 text-muted-foreground">「{conflict?.workspace_name}」及其全部对话改用所选文件夹，原位置的文件夹不再属于任何工作区。两个文件夹里的文件都不会被删除。</p></li>}
      </ul>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onCancel}>取消</Button>
        {options.includes('as_new') && <Button variant="outline" disabled={busy} onClick={() => onResolve('as_new')}>作为新工作区</Button>}
        {options.includes('rebind') && <Button disabled={busy} onClick={() => onResolve('rebind')}>改绑到这里</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
