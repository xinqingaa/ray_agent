import {createContext, useContext, useId, useState, type ComponentProps, type ReactNode} from 'react'
import {Slot} from '@radix-ui/react-slot'

/**
 * 展开收起的公共原语：内容区用网格行高从 0 过渡到自适应，收起后 inert 且不可见。
 * 受控传 open 与 onOpenChange，非受控传 defaultOpen。箭头类名放在触发器的直接子元素上，
 * 展开时随触发器的 aria-expanded 旋转：向下箭头转 180 度，向右箭头转 90 度。减少动态效果时直接切换，见 globals.css。
 */
export const collapsibleChevron = 'ui-collapsible-chevron'
export const collapsibleSideChevron = 'ui-collapsible-chevron-side'

type CollapsibleContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerId: string
  contentId: string
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null)

function useCollapsible() {
  const context = useContext(CollapsibleContext)
  if (!context) throw new Error('Collapsible 的触发器与内容必须放在 Collapsible 内')
  return context
}

export function Collapsible({open: controlled, defaultOpen = false, onOpenChange, children}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const open = controlled ?? uncontrolled
  const triggerId = useId()
  const contentId = useId()
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }
  return <CollapsibleContext.Provider value={{open, setOpen, triggerId, contentId}}>{children}</CollapsibleContext.Provider>
}

/** 触发器默认渲染为 type="button"；asChild 时合并到子元素（如 Button），子元素需自行提供可访问名称。 */
export function CollapsibleTrigger({asChild = false, onClick, className, children, ...props}: ComponentProps<'button'> & {asChild?: boolean}) {
  const {open, setOpen, triggerId, contentId} = useCollapsible()
  const handleClick: ComponentProps<'button'>['onClick'] = event => {
    onClick?.(event)
    if (!event.defaultPrevented) setOpen(!open)
  }
  const shared = {
    id: triggerId,
    'aria-expanded': open,
    'aria-controls': contentId,
    className: ['ui-collapsible-trigger', className].filter(Boolean).join(' '),
    onClick: handleClick,
    ...props,
  }
  if (asChild) return <Slot {...shared}>{children}</Slot>
  return <button type="button" {...shared}>{children}</button>
}

/** 内容区：收起时保留挂载（保持内部状态与草稿），但隐藏并从焦点顺序中移除。 */
export function CollapsibleContent({className, children}: {className?: string; children: ReactNode}) {
  const {open, contentId} = useCollapsible()
  return <div id={contentId} data-state={open ? 'open' : 'closed'}
    aria-hidden={!open || undefined} inert={!open} className="ui-collapsible-body">
    <div className="ui-collapsible-clip">
      <div className={className}>{children}</div>
    </div>
  </div>
}
