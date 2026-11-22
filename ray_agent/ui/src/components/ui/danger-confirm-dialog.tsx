import {useEffect, useRef, useState, type ReactNode} from 'react'
import {AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'

export type DangerConfirmDialogProps = {
  open: boolean
  /** 只会以 false 调用：取消、Esc 或确认成功后。提交中不会触发。 */
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** 标题与按钮之间的补充说明 */
  children?: ReactNode
  confirmLabel: string
  /** 提交中按钮上的文字 */
  busyLabel?: string
  cancelLabel?: string
  /**
   * 执行危险操作。成功则弹框关闭；抛出的错误作为说明显示在弹框内，弹框保持打开以便重试或取消。
   */
  onConfirm: () => Promise<void>
  /** 关闭后焦点回到的位置；省略时交给 Radix 回到触发元素。 */
  onRestoreFocus?: () => void
}

/**
 * 危险确认弹框（删除等不可撤回或影响他人界面的操作）。
 * - 焦点默认在取消；确认按钮为危险样式，写在右侧。
 * - 提交中不可关闭：Esc、遮罩与取消都无效，取消按钮禁用。
 * - 失败的说明留在弹框内，不另行弹出提示。
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  busyLabel = '正在处理',
  cancelLabel = '取消',
  onConfirm,
  onRestoreFocus,
}: DangerConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
    }
  }, [open])

  const requestClose = (next: boolean) => {
    if (!next && !busy) onOpenChange(false)
  }

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      setBusy(false)
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请重试')
      setBusy(false)
    }
  }

  return <AlertDialog open={open} onOpenChange={requestClose}>
    <AlertDialogContent
      onOpenAutoFocus={event => {
        event.preventDefault()
        cancelButton.current?.focus({preventScroll: true})
      }}
      onEscapeKeyDown={event => {if (busy) event.preventDefault()}}
      onCloseAutoFocus={onRestoreFocus && (event => {event.preventDefault(); onRestoreFocus()})}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
      </AlertDialogHeader>
      {children}
      {error && <p role="alert" className="rounded-md bg-state-failed-soft px-3 py-2 text-sm text-state-failed">{error}</p>}
      <AlertDialogFooter>
        <Button ref={cancelButton} variant="outline" disabled={busy} onClick={() => requestClose(false)}>{cancelLabel}</Button>
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? busyLabel : confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
