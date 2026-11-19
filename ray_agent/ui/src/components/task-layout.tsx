import {useEffect, useId, useRef, useState, type DragEvent, type ReactNode, type RefObject} from 'react'
import {Eye, Folder, FolderOpen, History, Inbox, PanelRight, Paperclip} from '@/components/ui/icons'
import {IconAction} from '@/components/ui/icon-action'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {useWorkbenchWidth, WorkbenchResizeHandle} from '@/components/workbench/resize-handle'
import {useIsMobile} from '@/hooks/use-mobile'
import {cn} from '@/lib/utils'
import {rootApi} from '@/lib/api/workspace'
import {TaskFilePicker} from '@/lib/task-file-picker'

const INSPECTOR_FLOAT_BREAKPOINT = 1181

export type InspectorView = 'folder' | 'delivered' | 'workbench' | 'recent'

export function TaskInspectorTabs({value, workspace, onChange, onClose, onActions}: {
  value: InspectorView; workspace: boolean; onChange: (value: InspectorView) => void; onClose?: () => void;
  onActions?: (target: HTMLDivElement | null) => void
}) {
  return <div className="flex min-h-11 shrink-0 items-center gap-1 px-2.5 pt-2 pb-1">
    <SegmentedControl<InspectorView> value={value} appearance="icons" onValueChange={onChange} label="右侧面板内容"
      options={[
        ...(workspace ? [{value: 'folder' as const, label: '文件夹', icon: Folder}] : []),
        {value: 'delivered', label: '成果', icon: Inbox},
        {value: 'workbench', label: '查看', icon: Eye},
        ...(workspace ? [{value: 'recent' as const, label: '修改', icon: History}] : []),
      ]}/>
    <div ref={onActions} className="ml-auto flex min-w-0 items-center gap-0.5"/>
    {onClose && <IconAction label="收起右侧面板" className="shrink-0 max-[540px]:hidden" onClick={onClose}><PanelRight/></IconAction>}
  </div>
}

export function useTaskInspector(defaultOpen: boolean) {
  const floating = useIsMobile(INSPECTOR_FLOAT_BREAKPOINT)
  const [open, setOpen] = useState<boolean | null>(null)
  return {floating, open: open ?? (defaultOpen && !floating), setOpen}
}

type DropTarget = 'attach' | 'folder'
type DropDirectory = {path: string; name: string}

/** Both conversation and workspace home use the same paper and file destinations. */
export function TaskLayout({children, inspector, attach, addToFolder, folderRootId, workspace = false}: {
  children: ReactNode; inspector?: ReactNode; attach?: (files: File[]) => void;
  addToFolder?: (files: File[], directory: string) => void; folderRootId?: string; workspace?: boolean
}) {
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [near, setNear] = useState<DropTarget | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<{rootId: string; entries: DropDirectory[]; error?: boolean; truncated?: boolean} | null>(null)
  const [retry, setRetry] = useState(0)
  const active = dragging || selectedFiles.length > 0
  const choosing = selectedFiles.length > 0
  const folderListing = listing?.rootId === folderRootId ? listing : null
  const location = folderListing?.entries.some(entry => entry.path === directory) ? directory : ''
  const chooserLabel = useId()
  const firstChoice = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active || !folderRootId) return
    let current = true
    void rootApi.entries(folderRootId).then(({entries, truncated}) => {
      if (current) setListing({rootId: folderRootId, entries: entries.filter(entry => entry.kind === 'directory')
        .map(entry => ({path: entry.path.relative_path, name: entry.name})), truncated})
    }).catch(() => {
      if (current) setListing({rootId: folderRootId, entries: [], error: true})
    })
    return () => {current = false}
  }, [active, folderRootId, retry])

  useEffect(() => {
    if (choosing) firstChoice.current?.focus()
  }, [choosing])

  const resetDrag = () => {
    depth.current = 0
    setDragging(false)
    setTarget(null)
    setNear(null)
  }
  const startChoice = (files: File[]) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDirectory('')
    setListing(null)
    setSelectedFiles(files)
  }
  const closeChoice = () => {
    setSelectedFiles([])
    requestAnimationFrame(() => previousFocus.current?.focus())
  }
  const finish = (destination: DropTarget, files: File[], path = location) => {
    if (choosing) closeChoice()
    resetDrag()
    if (!files.length) return
    if (destination === 'attach') attach?.(files)
    else addToFolder?.(files, path)
  }
  const accepts = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')
  const dropHit = (event: DragEvent): {target: DropTarget | null; directory?: string} => {
    if (!(event.target instanceof Element)) return {target: null}
    const chip = event.target.closest<HTMLElement>('[data-drop-directory]')
    if (chip) return {target: 'folder', directory: chip.dataset.dropDirectory}
    // The composer remains a direct attachment target underneath the drag overlay.
    const composer = event.currentTarget.querySelector<HTMLElement>('[data-chat-composer]')?.getBoundingClientRect()
    if (attach && composer && event.clientX >= composer.left && event.clientX <= composer.right &&
      event.clientY >= composer.top && event.clientY <= composer.bottom) return {target: 'attach'}
    const hit = event.target.closest<HTMLElement>('[data-task-drop]')?.dataset.taskDrop
    return {target: hit === 'folder' ? 'folder' : hit === 'attach' ? 'attach' : null}
  }

  return <div className="task-layout">
    <div className="task-paper"
      onDragEnter={event => {
        if (!accepts(event)) return
        event.preventDefault()
        if (choosing || (!attach && !addToFolder)) return
        if (depth.current === 0) {
          setDirectory('')
          setListing(null)
        }
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={event => {
        if (!accepts(event)) return
        event.preventDefault()
        if (choosing || (!attach && !addToFolder)) {
          event.dataTransfer.dropEffect = 'none'
          return
        }
        const hit = dropHit(event)
        event.dataTransfer.dropEffect = hit.target ? 'copy' : 'none'
        setTarget(hit.target)
        if (hit.directory !== undefined) setDirectory(hit.directory)
        const nearby = !hit.target && [...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-drop]')].find(node => {
          const bounds = node.getBoundingClientRect()
          return event.clientX >= bounds.left - 12 && event.clientX <= bounds.right + 12 &&
            event.clientY >= bounds.top - 12 && event.clientY <= bounds.bottom + 12
        })
        setNear(nearby ? nearby.dataset.taskDrop as DropTarget : null)
      }}
      onDragLeave={() => {
        if (depth.current === 0) return
        depth.current -= 1
        if (depth.current === 0) resetDrag()
      }}
      onDrop={event => {
        if (!accepts(event)) return
        event.preventDefault()
        if (choosing) return
        const hit = dropHit(event)
        if (hit.target) finish(hit.target, Array.from(event.dataTransfer.files), hit.directory ?? location)
        else resetDrag()
      }}>
      <div className="contents" inert={choosing}>
        <TaskFilePicker.Provider value={workspace && attach && addToFolder ? startChoice : null}>{children}</TaskFilePicker.Provider>
      </div>
      {active && (attach || addToFolder) && <div className="task-drop" data-choosing={choosing}
        role={choosing ? 'dialog' : undefined} aria-labelledby={choosing ? chooserLabel : undefined}
        onKeyDown={event => {if (choosing && event.key === 'Escape') {event.stopPropagation(); closeChoice()}}}>
        {choosing && <header className="task-drop-header">
          <strong id={chooserLabel}>将 {selectedFiles.length} 个文件添加到</strong>
          <button type="button" className="task-drop-cancel" onClick={closeChoice}>取消</button>
        </header>}
        {attach && <section className="task-drop-target" data-task-drop="attach" data-over={target === 'attach'} data-near={near === 'attach'}>
          <Paperclip aria-hidden/>
          {choosing ? <button ref={firstChoice} type="button" className="task-drop-action" onClick={() => finish('attach', selectedFiles)}>随这条消息发给 Agent</button>
            : <strong>随这条消息发给 Agent</strong>}
          <span>{workspace ? '作为这条消息的附件，发送时按工作区规则保存' : '放进本次对话的工作目录'}</span>
        </section>}
        {addToFolder && <section className="task-drop-target" data-task-drop="folder" data-over={target === 'folder'} data-near={near === 'folder'}>
          <FolderOpen aria-hidden/>
          {choosing ? <button ref={attach ? undefined : firstChoice} type="button" className="task-drop-action" onClick={() => finish('folder', selectedFiles)}>只加入文件夹</button>
            : <strong>只加入文件夹</strong>}
          <span>可索引的文件处理完成后，后续任务可以检索到</span>
          <div className="task-drop-directories" role="group" aria-label="目标目录">
            {[{path: '', name: '根目录'}, ...(folderListing?.entries ?? [])].map(entry => choosing
              ? <button key={entry.path} type="button" data-selected={location === entry.path} aria-pressed={location === entry.path}
                className="task-drop-directory" onClick={() => setDirectory(entry.path)}>{entry.name}{entry.path ? '/' : ''}</button>
              : <span key={entry.path} data-selected={location === entry.path} data-drop-directory={entry.path}
                className="task-drop-directory">{entry.name}{entry.path ? '/' : ''}</span>)}
          </div>
          {!folderListing && folderRootId && <span role="status">正在读取目录…</span>}
          {folderListing?.error && <span role="status">无法读取子目录{choosing && <> · <button type="button" className="underline" onClick={() => {
            setListing(null)
            setRetry(value => value + 1)
          }}>重试</button></>}</span>}
          {folderListing?.truncated && <span>显示部分目录</span>}
        </section>}
      </div>}
      {choosing && !attach && !addToFolder && <div className="task-drop" role="dialog" aria-label="添加文件">
        <span>当前无法添加文件。</span><button type="button" className="task-drop-cancel" onClick={closeChoice}>取消</button>
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
