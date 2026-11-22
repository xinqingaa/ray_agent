import {useState} from 'react'
import {DangerConfirmDialog} from '@/components/ui/danger-confirm-dialog'
import type {RootEntry} from '@/lib/api/types'

type EntryTarget = {path: string; entry: RootEntry}

/**
 * 删除文件或空文件夹的确认。焦点默认在取消；提交中不可关闭；失败的说明留在弹框内。
 * 删除进入「最近修改」，可以撤销，因此说明里写明；不进系统废纸篓。
 */
export function DeleteEntryDialog({target, onClose, onConfirm}: {
  target: EntryTarget | null
  onClose: () => void
  /** 失败时抛出带说明的 Error，弹框保持打开并显示说明 */
  onConfirm: (target: EntryTarget) => Promise<void>
}) {
  // 关闭动画期间保留上一次的对象，避免标题在收起时变空
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)
  const directory = shown?.entry.kind === 'directory'
  return <DangerConfirmDialog
    open={target != null}
    onOpenChange={next => {if (!next) onClose()}}
    title={shown ? `${directory ? '删除空文件夹' : '删除文件'}「${shown.entry.name}」？` : ''}
    description={directory ? '只能删除空文件夹，里面有内容时会被拒绝。' : '文件会从文件夹中移除，不会进入系统废纸篓。'}
    confirmLabel="删除"
    busyLabel="正在删除"
    onConfirm={() => target ? onConfirm(target) : Promise.resolve()}
  >
    <p className="text-sm text-muted-foreground">删除会记入「最近修改」，可以在那里撤销。</p>
  </DangerConfirmDialog>
}
