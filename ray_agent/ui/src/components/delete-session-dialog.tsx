import {DangerConfirmDialog} from '@/components/ui/danger-confirm-dialog'

type DeleteSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 失败时抛出带说明的 Error，弹框保持打开并显示说明 */
  onConfirm: () => Promise<void>
  onRestoreFocus?: () => void
}

/**
 * 删除对话的确认。确认后才发起 API 删除请求；提交中不可关闭，失败的说明留在弹框内。
 */
export function DeleteSessionDialog({open, onOpenChange, onConfirm, onRestoreFocus}: DeleteSessionDialogProps) {
  return <DangerConfirmDialog
    open={open}
    onOpenChange={onOpenChange}
    title="永久删除这段对话？"
    description="对话历史与附件将永久删除，无法恢复。工作区文件夹里的文件不受影响。"
    confirmLabel="永久删除对话"
    busyLabel="正在删除"
    onConfirm={onConfirm}
    onRestoreFocus={onRestoreFocus}
  />
}
