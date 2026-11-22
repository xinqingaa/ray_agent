import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import {cn} from "@/lib/utils"
import {DIALOG_OVERLAY_CLASS, DIALOG_PANEL_CLASS} from "@/components/ui/dialog"

// 危险确认等需要用户明确选择的弹框。外观与 Dialog 相同，但没有右上角关闭按钮，
// 遮罩点击不关闭；是否可以关闭由调用方通过 onEscapeKeyDown 等控制（见 DangerConfirmDialog）。

function AlertDialog({...props}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogPortal({...props}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({className, ...props}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className={cn(DIALOG_OVERLAY_CLASS, className)} {...props} />
}

function AlertDialogContent({className, ...props}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content data-slot="alert-dialog-content" className={cn(DIALOG_PANEL_CLASS, "sm:max-w-[440px]", className)} {...props} />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({className, ...props}: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />
}

function AlertDialogFooter({className, ...props}: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function AlertDialogTitle({className, ...props}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("text-base leading-snug font-semibold", className)} {...props} />
}

function AlertDialogDescription({className, ...props}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-muted-foreground text-sm leading-relaxed", className)} {...props} />
}

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
}
