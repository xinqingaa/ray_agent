import {useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject} from 'react'
import {Paperclip, FolderOpen} from '@/components/ui/icons'
import {useWorkbenchWidth, WorkbenchResizeHandle} from '@/components/workbench/resize-handle'
import {useIsMobile} from '@/hooks/use-mobile'
import {cn} from '@/lib/utils'

const INSPECTOR_FLOAT_BREAKPOINT = 1181

export function useTaskInspector(defaultOpen: boolean) {
  const floating = useIsMobile(INSPECTOR_FLOAT_BREAKPOINT)
  const [open, setOpen] = useState<boolean | null>(null)
  return {floating, open: open ?? (defaultOpen && !floating), setOpen}
}

/** Both conversation and workspace home use the same paper and file drop targets. */
export function TaskLayout({children, inspector, attach, addToFolder, folderLabel}: {
  children: ReactNode; inspector?: ReactNode; attach?: (files: File[]) => void;
  addToFolder?: (files: File[]) => void; folderLabel?: string
}) {
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [target, setTarget] = useState<'attach' | 'folder' | null>(null)
  const allowed = Boolean(attach || addToFolder)
  const accepts = (event: DragEvent) => allowed && Array.from(event.dataTransfer.types).includes('Files')
  const reset = () => {depth.current = 0; setDragging(false); setTarget(null)}

  return <div className="task-layout">
    <div className="task-paper"
      onDragEnter={event => {
        if (!accepts(event)) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={event => {
        if (!accepts(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-task-drop]')
        setTarget(hit?.dataset.taskDrop === 'folder' ? 'folder' : hit ? 'attach' : null)
      }}
      onDragLeave={() => {
        if (depth.current > 0) depth.current -= 1
        if (depth.current === 0) reset()
      }}
      onDrop={event => {
        if (!accepts(event)) return
        event.preventDefault()
        const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-task-drop]')?.dataset.taskDrop
        const files = Array.from(event.dataTransfer.files)
        reset()
        if (hit === 'attach') attach?.(files)
        if (hit === 'folder') addToFolder?.(files)
      }}>
      {children}
      {dragging && allowed && <div className="task-drop" aria-live="polite">
        {attach && <div data-task-drop="attach" data-over={target === 'attach'}><Paperclip/><strong>随这条消息发给 Agent</strong>
          <span>发送时作为这条消息的附件</span></div>}
        {addToFolder && <div data-task-drop="folder" data-over={target === 'folder'}><FolderOpen/><strong>只加入文件夹</strong>
          <span>{folderLabel ?? '复制到当前选中的目录，未选择时放到根目录'}</span></div>}
      </div>}
    </div>
    {inspector}
  </div>
}

/** The same content stays mounted while the right panel changes position or closes. */
export function TaskInspector({open, onClose, floating, label, belowSessionMode, triggerRef, children}: {
  open: boolean; onClose: () => void; floating: boolean; label: string; belowSessionMode?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>; children: ReactNode
}) {
  const width = useWorkbenchWidth()
  const [dragging, setDragging] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const previousOpen = useRef(false)

  useEffect(() => {
    const wasOpen = previousOpen.current
    previousOpen.current = open
    if (open && !wasOpen && floating && document.activeElement === triggerRef?.current) panel.current?.focus()
  }, [floating, open, triggerRef])

  useEffect(() => {
    if (!open || !floating) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return
      event.preventDefault()
      onClose()
      triggerRef?.current?.focus()
    }
    const outside = (event: PointerEvent) => {
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]')) return
      const target = event.target as Node
      if (target instanceof Element && target.closest('button, a, input, textarea, select, [role="button"], [role="menuitem"]')) return
      if (!panel.current?.contains(target)) onClose()
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerdown', outside)
    return () => {window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', outside)}
  }, [floating, onClose, open, triggerRef])

  return <aside ref={panel} tabIndex={-1} aria-label={label} aria-hidden={!open} inert={!open}
    data-open={open} data-below-mode={Boolean(belowSessionMode)}
    className={cn('task-inspector', dragging && 'transition-none')} style={{width: open ? width.width : 0}}>
    <div className="task-inspector-paper" style={{width: width.width}}>{children}</div>
    {open && !floating && <WorkbenchResizeHandle width={width.width} min={width.min} max={width.max}
      onWidth={width.setWidth} onReset={width.reset} onDragging={setDragging} label={`调整${label}宽度`}/>}
  </aside>
}
