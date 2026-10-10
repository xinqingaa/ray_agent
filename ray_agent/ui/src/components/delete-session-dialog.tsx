'use client'

import {useState} from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'

type DeleteSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

/**
 * 删除任务确认弹窗
 * 确认后才发起 API 删除请求
 */
export function DeleteSessionDialog({open, onOpenChange, onConfirm}: DeleteSessionDialogProps) {
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      await onConfirm()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            永久删除这段对话？
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            对话历史将永久删除，无法恢复。项目共享文件、说明与笔记会保留。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            className="cursor-pointer"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? '正在删除' : '永久删除对话'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


